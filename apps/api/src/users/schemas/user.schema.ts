import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  displayName: string;

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
}

export const UserSchema = SchemaFactory.createForClass(User);
