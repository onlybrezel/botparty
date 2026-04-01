import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ControlButtonAccess } from '@botparty/shared';

export class CreateControlButtonDto {
  @IsString()
  @MaxLength(32)
  label!: string;

  @IsString()
  @MaxLength(64)
  command!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  hotKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(10000)
  cooldownMs?: number;

  @IsOptional()
  @IsEnum(ControlButtonAccess)
  access?: ControlButtonAccess;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string;
}

export class UpdateControlButtonDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  command?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  hotKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(10000)
  cooldownMs?: number;

  @IsOptional()
  @IsEnum(ControlButtonAccess)
  access?: ControlButtonAccess;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string;
}

export class ReorderControlButtonsDto {
  /** Array of { id, position } pairs */
  @IsOptional()
  order!: Array<{ id: string; position: number }>;
}
