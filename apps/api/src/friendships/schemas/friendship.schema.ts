import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

/**
 * One row per pair, ids sorted so (a, b) and (b, a) collide. Entering a code
 * creates a PENDING row owned by the requester; the other person accepts.
 * Rows from before requests existed have no status and count as ACCEPTED.
 */
@Schema({ timestamps: true, collection: 'friendships' })
export class Friendship {
  @Prop({ required: true, index: true })
  userAId: string;

  @Prop({ required: true, index: true })
  userBId: string;

  @Prop({ type: String, enum: ['PENDING', 'ACCEPTED'], default: 'ACCEPTED' })
  status: FriendshipStatus;

  /** Who entered the code. Only the other person can accept. */
  @Prop({ type: String, default: null })
  requestedBy: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);
FriendshipSchema.index({ userAId: 1, userBId: 1 }, { unique: true });
