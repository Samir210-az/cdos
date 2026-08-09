import { Module } from '@nestjs/common';

/**
 * Faz 3.2 scope-u yalnız DB/auth/scope-cache/assignment SERVICE səviyyəsini əhatə edir.
 * HTTP controller-lər (auth.controller.ts, assignments.controller.ts və s.)
 * Faz 3.1 E bölməsindəki API contract-a uyğun olaraq NÖVBƏTİ fazda əlavə olunacaq.
 * Bu fayl strukturun mövcudluğunu təmin edir və gələcək genişlənmə üçün əsasdır.
 */
@Module({})
export class AppModule {}
