import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * Spotify credentials, held server-side only. The refresh token is a long-lived
 * credential — it is never included in UserDto and never reaches the browser.
 * The SPA talks to /api/spotify/* and this server talks to Spotify.
 */
export class SpotifyTokens {
  @Prop({ required: true })
  accessToken: string;

  @Prop({ required: true })
  refreshToken: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop()
  spotifyUserId?: string;

  @Prop()
  displayName?: string;

  @Prop({ type: Date })
  connectedAt?: Date;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  displayName: string;

  @Prop({ default: false })
  displayNameCustomized: boolean;

  @Prop({ required: true, unique: true, uppercase: true })
  pairingCode: string;

  @Prop()
  email?: string;

  @Prop()
  picture?: string;

  @Prop()
  schoolId?: string;

  @Prop()
  schoolName?: string;

  @Prop()
  city?: string;

  @Prop()
  weeklyRitual?: string;

  @Prop({ default: false })
  locationSharing: boolean;

  @Prop()
  coarseLat?: number;

  @Prop()
  coarseLon?: number;

  @Prop()
  placeLabel?: string;

  @Prop({ type: Date })
  locationUpdatedAt?: Date;
  @Prop({ type: Object, default: null })
  spotify?: SpotifyTokens | null;

  /** One-time CSRF state for an in-flight Spotify connect. */
  @Prop({ type: String, default: null })
  spotifyAuthState?: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
