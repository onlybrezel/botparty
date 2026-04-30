import {
  ArrayMaxSize,
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsArray,
  IsUUID,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ControlButtonAccess, LIMITS } from '@botparty/shared';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LIMITS.MAX_BUTTON_COST_CREDITS)
  costCredits?: number;
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

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LIMITS.MAX_BUTTON_COST_CREDITS)
  costCredits?: number;
}

export class ReorderControlButtonItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  position!: number;
}

export class ReorderControlButtonsDto {
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => ReorderControlButtonItemDto)
  order!: ReorderControlButtonItemDto[];
}
