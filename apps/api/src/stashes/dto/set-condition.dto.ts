import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetConditionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  conditionLabel!: string;
}
