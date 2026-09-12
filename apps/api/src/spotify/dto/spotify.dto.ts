import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SpotifyResolveDto {
  /** A track id, spotify:track: URI, or open.spotify.com link. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  url!: string;
}
