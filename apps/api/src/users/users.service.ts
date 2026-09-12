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
      const nextEmail = claims.email ?? existing.email;
      const nextPicture = claims.picture ?? existing.picture;
      let dirty = false;
      if (!existing.displayNameCustomized) {
        const nextName = claims.name ?? existing.displayName;
        if (existing.displayName !== nextName) {
          existing.displayName = nextName;
          dirty = true;
        }
      }
      if (existing.email !== nextEmail) {
        existing.email = nextEmail;
        dirty = true;
      }
      if (existing.picture !== nextPicture) {
        existing.picture = nextPicture;
        dirty = true;
      }
      if (dirty) {
        await existing.save();
      }
      return existing;
    }

    return this.userModel.create({
      _id: claims.sub,
      displayName: claims.name || claims.email || 'Friend',
      email: claims.email,
      picture: claims.picture,
      pairingCode: await this.uniquePairingCode(),
    });
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByPairingCode(code: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ pairingCode: code }).exec();
  }

  toDto(user: UserDocument): UserDto {
    const locationFresh =
      user.locationSharing &&
      user.locationUpdatedAt &&
      Date.now() - user.locationUpdatedAt.getTime() < 1000 * 60 * 45;
    return {
      id: user._id,
      displayName: user.displayName,
      pairingCode: user.pairingCode,
      pairingCodeDisplay: formatPairingCode(user.pairingCode),
      picture: user.picture,
      email: user.email,
      schoolId: user.schoolId,
      schoolName: user.schoolName,
      city: user.city,
      weeklyRitual: user.weeklyRitual,
      locationSharing: user.locationSharing,
      placeLabel: locationFresh ? user.placeLabel : undefined,
      locationUpdatedAt:
        locationFresh && user.locationUpdatedAt
          ? user.locationUpdatedAt.toISOString()
          : undefined,
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
      locationSharing?: boolean;
      stashAlertsEnabled?: boolean;
    },
  ): Promise<UserDocument> {
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim().slice(0, 40);
      if (name) {
        user.displayName = name;
        user.displayNameCustomized = true;
      }
    }
    if (patch.schoolId !== undefined) user.schoolId = patch.schoolId || undefined;
    if (patch.schoolName !== undefined) user.schoolName = patch.schoolName || undefined;
    if (patch.city !== undefined) user.city = patch.city || undefined;
    if (patch.weeklyRitual !== undefined) user.weeklyRitual = patch.weeklyRitual || undefined;
    if (patch.locationSharing !== undefined) {
      user.locationSharing = patch.locationSharing;
      if (!patch.locationSharing) {
        user.placeLabel = undefined;
        user.coarseLat = undefined;
        user.coarseLon = undefined;
        user.locationUpdatedAt = undefined;
      }
    }
    if (patch.stashAlertsEnabled !== undefined) {
      user.stashAlertsEnabled = patch.stashAlertsEnabled;
    }
    await user.save();
    return user;
  }

  async listAlertOptIns(): Promise<UserDocument[]> {
    return this.userModel.find({ stashAlertsEnabled: true }).exec();
  }

  async updateLocation(
    user: UserDocument,
    body: { coarseLat: number; coarseLon: number; placeLabel?: string },
  ): Promise<UserDocument> {
    if (!user.locationSharing) {
      user.locationSharing = true;
    }
    user.coarseLat = body.coarseLat;
    user.coarseLon = body.coarseLon;
    user.placeLabel = body.placeLabel?.trim().slice(0, 40) || undefined;
    user.locationUpdatedAt = new Date();
    await user.save();
    return user;
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
