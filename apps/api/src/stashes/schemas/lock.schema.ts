import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ConditionType, LockState } from '@stashd/shared';
import { HydratedDocument } from 'mongoose';

export type LockDocument = HydratedDocument<Lock>;

@Schema({ timestamps: true, collection: 'locks' })
export class Lock {
  @Prop({ required: true, index: true })
  senderId: string;

  @Prop({ required: true, index: true })
  recipientId: string;

  @Prop({ required: true })
  text: string;

  @Prop()
  imageUrl?: string;

  @Prop({ required: true, enum: ['MANUAL', 'TOGETHER', 'RECIPIENT_SET'] })
  conditionType: ConditionType;

  @Prop({ type: String, default: null })
  conditionLabel: string | null;

  @Prop({
    required: true,
    enum: ['LOCKED', 'READY', 'UNLOCKED'],
    default: 'LOCKED',
  })
  state: LockState;

  @Prop({ default: false })
  senderConfirmed: boolean;

  @Prop({ default: false })
  recipientConfirmed: boolean;

  @Prop({ type: Date, default: null })
  unlockedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LockSchema = SchemaFactory.createForClass(Lock);
