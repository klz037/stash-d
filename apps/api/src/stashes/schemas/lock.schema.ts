import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ConditionType,
  LockContext,
  LockState,
  MAX_MOMENT_LENGTH,
  MediaKind,
} from '@stashd/shared';
import { HydratedDocument } from 'mongoose';

export type LockDocument = HydratedDocument<Lock>;

/**
 * A stashed song. Every field here is content: the album art is the reveal, so
 * the whole object is stripped from the response until the lock is UNLOCKED.
 * Written only from SpotifyService.resolveTrack, never from client input.
 */
export class LockSong {
  @Prop({ required: true })
  trackId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  artist: string;

  @Prop({ required: true })
  albumArtUrl: string;

  @Prop({ required: true })
  spotifyUrl: string;

  @Prop()
  previewUrl?: string;

  @Prop()
  durationMs?: number;
}

@Schema({ timestamps: true, collection: 'locks' })
export class Lock {
  @Prop({ required: true, index: true })
  senderId: string;

  /**
   * One id for a 1:1 lock, N for a group lock. The sender may appear here too
   * (a self-stash, or "us"). Multikey index keeps the inbox query cheap.
   */
  @Prop({ type: [String], required: true, index: true })
  recipientIds: string[];

  /**
   * The note. Optional: a photo or a song alone is a fine stash. Mongoose
   * treats '' as missing for a required string, which is what 500'd every
   * note-less stash.
   */
  @Prop({ type: String, default: '' })
  text: string;

  @Prop()
  imageUrl?: string;

  @Prop({ type: Object, default: null })
  song?: LockSong | null;

  /**
   * Stays visible while the lock is sealed so the Stash can show a record
   * sleeve. The kind of content is metadata; the content itself is not.
   */
  @Prop({
    required: true,
    enum: ['TEXT', 'PHOTO', 'SONG'],
    default: 'TEXT',
  })
  mediaKind: MediaKind;

  @Prop({ required: true, enum: ['MANUAL', 'TOGETHER', 'RECIPIENT_SET'] })
  conditionType: ConditionType;

  @Prop({ type: String, default: null })
  conditionLabel: string | null;

  /** The moment the sender tied this to, normalized free text ("getting coffee"), or null. */
  @Prop({ type: String, default: null, maxlength: MAX_MOMENT_LENGTH })
  context: LockContext | null;

  /** Stamped when a recipient taps "I'm here" with a matching context. A timestamp, not a state. */
  @Prop({ type: Date, default: null })
  contextMetAt: Date | null;

  @Prop({ type: String, default: null })
  contextMetBy: string | null;

  /** Sender asked for a second key. Confirm is refused unless the token carries the MFA claim. */
  @Prop({ default: false })
  requiresMfa: boolean;

  /**
   * Pair "open together" is a trade. The recipient's stash-back carries
   * replyToId; the original carries replyId once it exists. They open as one.
   */
  @Prop({ type: String, default: null, index: true })
  replyToId: string | null;

  @Prop({ type: String, default: null })
  replyId: string | null;

  /** When the original sender started opening. The one-minute wait counts from here. */
  @Prop({ type: Date, default: null })
  openingStartedAt: Date | null;

  /** The sender waited out the minute and their side opened without the recipient. */
  @Prop({ default: false })
  openedAlone: boolean;

  @Prop({
    required: true,
    enum: ['LOCKED', 'READY', 'UNLOCKED'],
    default: 'LOCKED',
  })
  state: LockState;

  /** Users who have completed a hold. TOGETHER unlocks when this covers every participant. */
  @Prop({ type: [String], default: [] })
  confirmedIds: string[];

  @Prop({ type: Date, default: null })
  unlockedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LockSchema = SchemaFactory.createForClass(Lock);
