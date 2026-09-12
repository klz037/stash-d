import { IsString, MinLength } from 'class-validator';

export class PairDto {
  @IsString()
  @MinLength(1)
  code!: string;
}
