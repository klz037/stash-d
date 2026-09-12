import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { PromptCopySource, StashAlertKind } from '@stashd/shared';

const KINDS: StashAlertKind[] = ['athletics', 'tradition', 'food', 'event', 'news'];

export class PreviewAlertsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  seed?: string;
}

export class AlertDraftBodyDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(400)
  body!: string;

  @IsIn(KINDS)
  kind!: StashAlertKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  friendId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  friendName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  schoolId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  schoolName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedCondition?: string;

  @IsOptional()
  @IsIn(['ifm', 'fallback'])
  copySource?: PromptCopySource;
}

export class SendAlertNowDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AlertDraftBodyDto)
  draft?: AlertDraftBodyDto;
}
