import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { SongDto, SpotifyNowPlayingDto, SpotifyStatusDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from '../users/schemas/user.schema';
import { SpotifyResolveDto } from './dto/spotify.dto';
import { SpotifyService } from './spotify.service';

@Controller('spotify')
export class SpotifyController {
  constructor(private readonly spotify: SpotifyService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: UserDocument): SpotifyStatusDto {
    return {
      available: this.spotify.isAvailable,
      connected: Boolean(user.spotify?.refreshToken),
      displayName: user.spotify?.displayName,
    };
  }

  @Get('authorize-url')
  @UseGuards(JwtAuthGuard)
  async authorizeUrl(@CurrentUser() user: UserDocument): Promise<{ url: string }> {
    return { url: await this.spotify.authorizeUrl(user) };
  }

  /**
   * Spotify redirects the browser here. This is the one route in the app
   * without the JWT guard, and it has to be: a top-level redirect carries no
   * Authorization header. It is not a domain route — it reads nothing and
   * returns nothing about a lock. The one-time `state` is the credential: this
   * server generated it, stored it against exactly one user, and burns it on
   * first use. A wrong or replayed state connects nobody.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const back = (status: string) =>
      `${this.spotify.webOrigin}/?spotify=${encodeURIComponent(status)}`;

    if (error) {
      res.redirect(back(error === 'access_denied' ? 'declined' : 'error'));
      return;
    }
    if (!code || !state) {
      res.redirect(back('error'));
      return;
    }

    try {
      await this.spotify.completeConnectByState(code, state);
      res.redirect(back('connected'));
    } catch {
      // Never leak the reason into a URL a stranger could have triggered.
      res.redirect(back('error'));
    }
  }

  @Get('now-playing')
  @UseGuards(JwtAuthGuard)
  nowPlaying(@CurrentUser() user: UserDocument): Promise<SpotifyNowPlayingDto> {
    return this.spotify.nowPlaying(user);
  }

  @Post('resolve')
  @UseGuards(JwtAuthGuard)
  resolve(
    @CurrentUser() user: UserDocument,
    @Body() body: SpotifyResolveDto,
  ): Promise<SongDto> {
    return this.spotify.resolveTrack(user, body.url);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: UserDocument): Promise<SpotifyStatusDto> {
    await this.spotify.disconnect(user);
    return { available: this.spotify.isAvailable, connected: false };
  }
}
