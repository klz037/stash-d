import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GroupDocument = HydratedDocument<Group>;

/**
 * A named set of people with an invite code. Pairing, N-way. Being in a group
 * with someone lets you stash to them. Locks do not reference groups: picking
 * a group in capture just fills in recipientIds.
 */
@Schema({ timestamps: true, collection: 'groups' })
export class Group {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, uppercase: true })
  inviteCode: string;

  @Prop({ required: true, index: true })
  createdBy: string;

  @Prop({ type: [String], required: true, index: true })
  memberIds: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
