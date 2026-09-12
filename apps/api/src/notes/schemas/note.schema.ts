import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NoteDocument = HydratedDocument<Note>;

@Schema({ timestamps: true, collection: 'friend_notes' })
export class Note {
  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, index: true })
  friendId: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NoteSchema = SchemaFactory.createForClass(Note);
