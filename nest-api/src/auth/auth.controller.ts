import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/security';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsString({ message: 'username is required' })
  @IsNotEmpty({ message: 'username is required' })
  @MaxLength(120, { message: 'username is too long' })
  username: string;

  @IsString({ message: 'password is required' })
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(200, { message: 'password is too long' })
  password: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: LoginDto) {
    return this.auth.login(body.username, body.password);
  }
}
