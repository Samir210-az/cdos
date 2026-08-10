import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Faz 3.15 bənd II: yalnız auth üçün açıq (anonymous) endpoint-lər bunu istifadə edir. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
