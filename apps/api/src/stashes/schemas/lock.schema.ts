import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ConditionType,
  CONTEXTS,
  LockContext,
  LockState,
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

  @Prop({ required: true })
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

  /** Context the sender attached to the condition, or null. */
  @Prop({ type: String, enum: [...CONTEXTS, null], default: null })
  context: LockContext | null;

  /** Stamped when a recipient taps "I'm here" with a matching context. A timestamp, not a state. */
  @Prop({ type: Date, default: null })
  contextMetAt: Date | null;

  @Prop({ type: String, default: null })
  contextMetBy: string | null;

  /** Sender asked for a second key. Confirm is refused unless the token carries the MFA claim. */
  @Prop({ default: false })
  requiresMfa: boolean;

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
