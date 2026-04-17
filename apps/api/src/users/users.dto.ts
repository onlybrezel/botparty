import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  @MaxLength(512)
  avatarUrl?: string;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  username?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @MaxLength(64)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'MOD', 'USER'])
  role?: 'ADMIN' | 'MOD' | 'USER';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  credits?: number;

  @IsOptional()
  @IsInt()
  balance?: number;
}
