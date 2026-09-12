import { ConditionType } from '@stashd/shared';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateLockDto {
  @ValidateIf((body: CreateLockDto) => !body.groupId)
  @IsString()
  @IsNotEmpty()
  recipientId?: string;

  @ValidateIf((body: CreateLockDto) => !body.recipientId)
  @IsString()
  @IsNotEmpty()
  groupId?: string;

  @IsString()
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  imageUrl?: string;

  @IsIn(['MANUAL', 'TOGETHER', 'RECIPIENT_SET'])
  conditionType!: ConditionType;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  conditionLabel?: string;
}
