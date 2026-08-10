import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainExceptionFilter } from './common/http/domain-exception.filter';
import { AuthController } from './modules/auth/http/auth.controller';
import { AssignmentsController } from './modules/assignments/http/assignments.controller';
import { AssessmentsController } from './modules/assessments/http/assessments.controller';
import { PlansController } from './modules/plans/http/plans.controller';
import { SessionsController } from './modules/sessions/http/sessions.controller';
import { ReportsController } from './modules/reports/http/reports.controller';
import { DocumentsController } from './modules/documents/http/documents.controller';
import { ConsentsController } from './modules/consents/http/consents.controller';
import { FinanceController } from './modules/finance/http/finance.controller';
import { PlatformBillingController } from './modules/platform-billing/http/platform-billing.controller';
import { AIController } from './modules/ai/http/ai.controller';

/**
 * Faz 3.15: mövcud service-layer üzərində HTTP application layer.
 * QEYD (IMPLEMENTATION GAP): "children"/"parents" üçün ayrıca service-layer
 * heç vaxt yaradılmayıb (bütün əvvəlki fazlarda birbaşa SQL/migrator
 * istifadə olunub) — ona görə ChildrenController/ParentsController BURADA
 * YARADILMIR (uydurma service üzərində controller yazmaq əvəzinə, açıq
 * IMPLEMENTATION GAP kimi FINAL REPORT-da qeyd olunur).
 */
@Module({
  controllers: [
    AuthController,
    AssignmentsController,
    AssessmentsController,
    PlansController,
    SessionsController,
    ReportsController,
    DocumentsController,
    ConsentsController,
    FinanceController,
    PlatformBillingController,
    AIController,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
