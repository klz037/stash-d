import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

@Schema({ timestamps: true, collection: 'friendships' })
export class Friendship {
  @Prop({ required: true, index: true })
  userAId: string;

  @Prop({ required: true, index: true })
  userBId: string;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);
FriendshipSchema.index({ userAId: 1, userBId: 1 }, { unique: true });
