import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CallOutcome, CallReason, CallStatus, OUTCOMES, REASONS, STATUSES } from './call-record.entity';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListCallsQuery {
  @IsOptional()
  @IsIn(STATUSES, { message: `status must be one of ${STATUSES.join(', ')}` })
  status?: CallStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'q is too long' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a whole number' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size must be a whole number' })
  size?: number;
}

export class RevealDto {
  // trimmed first, so ten spaces are not a reason; Length also refuses a missing value, a blank one and a non-string
  @Transform(trimmed)
  @Length(10, 300, { message: 'Give a reason of 10 to 300 characters' })
  reason: string;
}

export class StatusDto {
  @IsIn(STATUSES, { message: `status must be one of ${STATUSES.join(', ')}` })
  status: CallStatus;
}

export class IngestLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  speaker: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}

/** The call as the voice platform delivers it. externalId makes redelivery idempotent. */
export class IngestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  externalId: string;

  @IsISO8601()
  startedAt: string;

  @IsInt()
  @Min(0)
  @Max(7200)
  durationSec: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  agent: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  callerNumber: string;

  @IsIn(REASONS)
  reason: CallReason;

  @IsIn(OUTCOMES)
  outcome: CallOutcome;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  patientName: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IngestLineDto)
  transcript: IngestLineDto[];
}
