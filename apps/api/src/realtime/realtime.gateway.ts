import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { FriendRequestDto, GroupDto, LockDto, SOCKET_EVENTS } from '@stashd/shared';
import { decode, verify, JwtHeader, VerifyOptions } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { Server, Socket } from 'socket.io';
import { AuthClaims } from '../auth/auth.types';
import { readAuth0Config } from '../auth/auth0.config';
import { participants } from '../stashes/lock.engine';
import { LockDocument } from '../stashes/schemas/lock.schema';
import { UsersService } from '../users/users.service';

type AuthedSocket = Socket & { userId?: string };

/** One LockDto per participant id, each shaped for that viewer. */
type LockViews = Map<string, LockDto>;

@WebSocketGateway({
  maxHttpBufferSize: 5e6,
  cors: { origin: true, credentials: true },
  namespace: '/',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly online = new Map<string, Set<string>>();
  private readonly jwks: JwksClient;
  private readonly verifyOptions: VerifyOptions;

  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    // Same validation as the HTTP strategy — the socket is a token acceptor too,
    // so it must not be able to boot with a weaker check. See auth0.config.ts.
    const auth0 = readAuth0Config(config);
    this.jwks = new JwksClient({
      jwksUri: auth0.jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    this.verifyOptions = {
      audience: auth0.audience,
      issuer: auth0.issuer,
      algorithms: ['RS256'],
    };
  }

  async handleConnection(@ConnectedSocket() client: AuthedSocket) {
    try {
      const token = this.readToken(client);
      const claims = await this.verifyToken(token);
      const user = await this.usersService.getOrCreate(claims);
      client.userId = user._id;
      await client.join(this.userRoom(user._id));
      this.addPresence(user._id, client.id);
    } catch (error) {
      this.logger.debug(`Socket rejected: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() client: AuthedSocket) {
    if (!client.userId) {
      return;
    }
    this.removePresence(client.userId, client.id);
  }

  /**
   * Presence is tracked in memory but never broadcast. It is read back only
   * through GET /api/friends, which returns it for people you are paired with.
   * Pushing it over the socket would have meant telling strangers when you are
   * online — see the note on removePresence.
   */
  isOnline(userId: string): boolean {
    return (this.online.get(userId)?.size ?? 0) > 0;
  }

  /** Recipients hear `lock:created`; a sender who is not also a recipient hears `lock:updated`. */
  notifyLockCreated(lock: LockDocument, views: LockViews) {
    for (const id of participants(lock)) {
      const event = lock.recipientIds.includes(id)
        ? SOCKET_EVENTS.lockCreated
        : SOCKET_EVENTS.lockUpdated;
      this.emitTo(id, event, views.get(id));
    }
  }

  notifyLockUpdated(lock: LockDocument, views: LockViews) {
    for (const id of participants(lock)) {
      this.emitTo(id, SOCKET_EVENTS.lockUpdated, views.get(id));
    }
  }

  /** After a hold: everyone on the lock hears the same state event, shaped for them. */
  notifyLockChange(lock: LockDocument, views: LockViews) {
    const event =
      lock.state === 'UNLOCKED'
        ? SOCKET_EVENTS.lockUnlocked
        : lock.state === 'READY'
          ? SOCKET_EVENTS.lockReady
          : SOCKET_EVENTS.lockUpdated;
    for (const id of participants(lock)) {
      this.emitTo(id, event, views.get(id));
    }
  }

  /** Every member hears the new roster, so their group list and recipient picker stay current. */
  notifyGroupUpdated(group: GroupDto) {
    for (const id of group.memberIds) {
      this.toUser(id).emit(SOCKET_EVENTS.groupUpdated, group);
    }
  }

  /** Someone entered your code. Only you hear it; nothing is shared until you accept. */
  notifyFriendRequested(toUserId: string, request: FriendRequestDto) {
    this.toUser(toUserId).emit(SOCKET_EVENTS.friendRequested, request);
  }

  notifyPaired(userId: string, friendId: string) {
    this.toUser(userId).emit(SOCKET_EVENTS.friendPaired, { friendId });
    this.toUser(friendId).emit(SOCKET_EVENTS.friendPaired, { friendId: userId });
  }

  private emitTo(userId: string, event: string, dto: LockDto | undefined) {
    if (!dto) {
      return;
    }
    this.toUser(userId).emit(event, dto);
  }

  private toUser(userId: string) {
    return this.server.to(this.userRoom(userId));
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private addPresence(userId: string, socketId: string) {
    const sockets = this.online.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.online.set(userId, sockets);
  }

  /**
   * Returns whether the user still has another socket open.
   *
   * This used to be paired with a server-wide `this.server.emit(...)` that told
   * every connected client when any user came online or went offline, including
   * users they had never paired with. Presence is not in SPEC.md, nothing in the
   * web app ever listened for the event, and scoping it correctly would have
   * required a circular dependency between the realtime and friendship modules.
   * The broadcast was removed rather than narrowed.
   */
  private removePresence(userId: string, socketId: string): boolean {
    const sockets = this.online.get(userId);
    if (!sockets) {
      return false;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.online.delete(userId);
      return false;
    }
    return true;
  }

  private readToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string };
    const header = client.handshake.headers.authorization;
    const fromHeader = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    const token = auth.token || fromHeader;
    if (!token) {
      throw new Error('Missing access token');
    }
    return token;
  }

  private async verifyToken(token: string): Promise<AuthClaims> {
    const parsed = decode(token, { complete: true });
    if (!parsed || typeof parsed === 'string' || !parsed.header.kid) {
      throw new Error('Invalid token');
    }
    const key = await this.signingKey(parsed.header);
    const payload = verify(token, key, this.verifyOptions) as AuthClaims;
    if (!payload.sub) {
      throw new Error('Token missing sub');
    }
    return payload;
  }

  private signingKey(header: JwtHeader): Promise<string> {
    return new Promise((resolve, reject) => {
      this.jwks.getSigningKey(header.kid as string, (err, key) => {
        if (err || !key) {
          reject(err ?? new Error('Missing signing key'));
          return;
        }
        resolve(key.getPublicKey());
      });
    });
  }
}
