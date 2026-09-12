import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ComposePromptDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  schoolId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  schoolName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  cue!: string;

  @IsIn([
    'athletics',
    'tradition',
    'food',
    'calendar',
    'weather',
    'place',
    'soft',
  ])
  emotion!:
    | 'athletics'
    | 'tradition'
    | 'food'
    | 'calendar'
    | 'weather'
    | 'place'
    | 'soft';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientName?: string;
}
