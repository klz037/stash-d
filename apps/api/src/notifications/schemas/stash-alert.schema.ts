import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { CurationSource, PromptCopySource, StashAlertKind } from '@stashd/shared';

export type StashAlertDocument = HydratedDocument<StashAlert>;

@Schema({ timestamps: true, collection: 'stash_alerts' })
export class StashAlert {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  day: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ required: true })
  kind: StashAlertKind;

  @Prop()
  friendId?: string;

  @Prop()
  friendName?: string;

  @Prop()
  schoolId?: string;

  @Prop()
  schoolName?: string;

  @Prop()
  sourceLabel?: string;

  @Prop()
  sourceUrl?: string;

  @Prop()
  suggestedCondition?: string;

  @Prop()
  copySource?: PromptCopySource;

  @Prop()
  curationSource?: CurationSource;

  @Prop({ default: false })
  deliveredPush: boolean;

  @Prop({ default: false })
  acknowledged: boolean;
}

export const StashAlertSchema = SchemaFactory.createForClass(StashAlert);
StashAlertSchema.index({ userId: 1, day: 1 });
