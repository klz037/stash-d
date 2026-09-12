import { ConditionType } from '@stashd/shared';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLockDto {
  @IsString()
  @IsNotEmpty()
  recipientId!: string;

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
