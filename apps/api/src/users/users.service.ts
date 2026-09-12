import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { formatPairingCode, generatePairingCode, UserDto } from '@stashd/shared';
import { Model } from 'mongoose';
import { AuthClaims } from '../auth/auth.types';
import { SpotifyTokens, User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getOrCreate(claims: AuthClaims): Promise<UserDocument> {
    const existing = await this.userModel.findById(claims.sub).exec();
    if (existing) {
      // A name the user typed themselves wins over whatever Auth0 says.
      const nextName = existing.displayNameSet
        ? existing.displayName
        : (claims.name ?? existing.displayName);
      const nextEmail = claims.email ?? existing.email;
      const nextPicture = claims.picture ?? existing.picture;
      if (
        existing.displayName !== nextName ||
        existing.email !== nextEmail ||
        existing.picture !== nextPicture
      ) {
        existing.displayName = nextName;
        existing.email = nextEmail;
        existing.picture = nextPicture;
        await existing.save();
      }
      return existing;
    }

    try {
      return await this.userModel.create({
        _id: claims.sub,
        displayName: claims.name || claims.email || 'Friend',
        email: claims.email,
        picture: claims.picture,
        pairingCode: await this.uniquePairingCode(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error;
      }

      const retry = await this.userModel.findById(claims.sub).exec();
      if (!retry) {
        throw error;
      }

      const nextName = retry.displayNameSet ? retry.displayName : (claims.name ?? retry.displayName);
      const nextEmail = claims.email ?? retry.email;
      const nextPicture = claims.picture ?? retry.picture;
      if (
        retry.displayName !== nextName ||
        retry.email !== nextEmail ||
        retry.picture !== nextPicture
      ) {
        retry.displayName = nextName;
        retry.email = nextEmail;
        retry.picture = nextPicture;
        await retry.save();
      }
      return retry;
    }
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findMany(ids: string[]): Promise<UserDocument[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.userModel.find({ _id: { $in: ids } }).exec();
  }

  async findByPairingCode(code: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ pairingCode: code }).exec();
  }

  toDto(user: UserDocument): UserDto {
    return {
      id: user._id,
      displayName: user.displayName,
      displayNameSet: Boolean(user.displayNameSet),
      pairingCode: user.pairingCode,
      pairingCodeDisplay: formatPairingCode(user.pairingCode),
      picture: user.picture,
      email: user.email,
      schoolId: user.schoolId,
      schoolName: user.schoolName,
      city: user.city,
      weeklyRitual: user.weeklyRitual,
      spotifyConnected: Boolean(user.spotify?.refreshToken),
      stashAlertsEnabled: Boolean(user.stashAlertsEnabled),
    };
  }

  async updateProfile(
    user: UserDocument,
    patch: {
      displayName?: string;
      schoolId?: string;
      schoolName?: string;
      city?: string;
      weeklyRitual?: string;
      stashAlertsEnabled?: boolean;
    },
  ): Promise<UserDocument> {
    const name = patch.displayName?.trim();
    if (name) {
      user.displayName = name.slice(0, 40);
      user.displayNameSet = true;
    }
    if (patch.schoolId !== undefined) user.schoolId = patch.schoolId || undefined;
    if (patch.schoolName !== undefined) user.schoolName = patch.schoolName || undefined;
    if (patch.city !== undefined) user.city = patch.city || undefined;
    if (patch.weeklyRitual !== undefined) user.weeklyRitual = patch.weeklyRitual || undefined;
    if (patch.stashAlertsEnabled !== undefined) user.stashAlertsEnabled = patch.stashAlertsEnabled;
    await user.save();
    return user;
  }

  async listAlertOptIns(): Promise<UserDocument[]> {
    return this.userModel.find({ stashAlertsEnabled: true }).exec();
  }

  /** Finds the user an in-flight Spotify connect belongs to. */
  async findBySpotifyState(state: string): Promise<UserDocument | null> {
    if (!state) {
      return null;
    }
    return this.userModel.findOne({ spotifyAuthState: state }).exec();
  }

  async setSpotifyState(
    user: UserDocument,
    state: string | undefined,
  ): Promise<void> {
    user.spotifyAuthState = state ?? null;
    await user.save();
  }

  async setSpotifyTokens(
    user: UserDocument,
    tokens: SpotifyTokens,
  ): Promise<void> {
    user.spotify = tokens;
    await user.save();
  }

  async clearSpotify(user: UserDocument): Promise<void> {
    user.spotify = null;
    user.spotifyAuthState = null;
    await user.save();
  }

  private async uniquePairingCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generatePairingCode();
      const clash = await this.userModel.exists({ pairingCode: code });
      if (!clash) {
        return code;
      }
    }
    throw new Error('Could not generate a unique pairing code');
  }
}
