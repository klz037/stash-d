import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GroupDocument = HydratedDocument<Group>;

@Schema({ timestamps: true, collection: 'groups' })
export class Group {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, uppercase: true })
  inviteCode: string;

  @Prop({ required: true, index: true })
  createdBy: string;

  @Prop({ type: [String], required: true })
  memberIds: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
