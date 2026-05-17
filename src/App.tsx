import { lazy, Suspense, useEffect, useState, useTransition } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AuthProvider } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { GymLoader } from "@/components/ui/gym-loader";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardRedirect } from "@/components/auth/DashboardRedirect";
import WhatsAppWidget from "@/components/common/WhatsAppWidget";
import { DrBanner } from "@/components/system/DrBanner";

// Critical auth pages — loaded eagerly (small bundles)
import SetupPage from "./pages/Setup";
import AuthPage from "./pages/Auth";
import SetPasswordPage from "./pages/SetPassword";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import UnauthorizedPage from "./pages/Unauthorized";
import NotFound from "./pages/NotFound";
import InclineAscent from "./pages/InclineAscent";
import EmbedLeadForm from "./pages/EmbedLeadForm";
import PrivacyPolicyPage from "./pages/PrivacyPolicy";
import TermsPage from "./pages/Terms";
const DataDeletionPage = lazy(() => import("./pages/DataDeletion"));
import ContractSignPage from "./pages/ContractSign";
const MemberCheckout = lazy(() => import("./pages/MemberCheckout"));
const PublicRegistrationPage = lazy(() => import("./pages/PublicRegistration"));

// All other pages — lazy loaded for code splitting
const DashboardPage = lazy(() => import("./pages/Dashboard"));

const MembersPage = lazy(() => import("./pages/Members"));
const LeadsPage = lazy(() => import("./pages/Leads"));
const PlansPage = lazy(() => import("./pages/Plans"));
const InvoicesPage = lazy(() => import("./pages/Invoices"));
const PaymentsPage = lazy(() => import("./pages/Payments"));
const ClassesPage = lazy(() => import("./pages/Classes"));
const PTSessionsPage = lazy(() => import("./pages/PTSessions"));
const CreateModePickerPage = lazy(() => import("./pages/fitness/CreateModePicker"));
const CreateAIPage = lazy(() => import("./pages/fitness/CreateAI"));
const CreateManualPage = lazy(() => import("./pages/fitness/CreateManual"));
const PreviewPlanPage = lazy(() => import("./pages/fitness/PreviewPlan"));
const FitnessTemplatesPage = lazy(() => import("./pages/fitness/Templates"));
const FitnessMemberPlansPage = lazy(() => import("./pages/fitness/MemberPlans"));

const EquipmentMaintenancePage = lazy(() => import("./pages/EquipmentMaintenance"));
const LockersPage = lazy(() => import("./pages/Lockers"));
const EmployeesPage = lazy(() => import("./pages/Employees"));
const HRMPage = lazy(() => import("./pages/HRM"));
const TrainersPage = lazy(() => import("./pages/Trainers"));
const StaffAttendancePage = lazy(() => import("./pages/StaffAttendance"));
const AttendanceDashboardPage = lazy(() => import("./pages/AttendanceDashboard"));
const TasksPage = lazy(() => import("./pages/Tasks"));
const AnalyticsPage = lazy(() => import("./pages/Analytics"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogs"));
const BranchesPage = lazy(() => import("./pages/Branches"));
const AnnouncementsPage = lazy(() => import("./pages/Announcements"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const IntegrationsPage = lazy(() => import("./pages/Integrations"));
const IntegrationWebhooksPage = lazy(() => import("./pages/IntegrationWebhooks"));
const StorePage = lazy(() => import("./pages/Store"));
const POSPage = lazy(() => import("./pages/POS"));
const ReferralsPage = lazy(() => import("./pages/Referrals"));
const FeedbackPage = lazy(() => import("./pages/Feedback"));
const WhatsAppChatPage = lazy(() => import("./pages/WhatsAppChat"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const ContactBookPage = lazy(() => import("./pages/ContactBook"));
const FinancePage = lazy(() => import("./pages/Finance"));
const MemberPlansPage = lazy(() => import("./pages/MemberPlans"));
const ProductsPage = lazy(() => import("./pages/Products"));
const ProductCategoriesPage = lazy(() => import("./pages/ProductCategories"));
const BenefitTrackingPage = lazy(() => import("./pages/BenefitTracking"));
const AllBookingsPage = lazy(() => import("./pages/AllBookings"));

// Member-specific pages
const MemberDashboard = lazy(() => import("./pages/MemberDashboard"));
const MyAttendance = lazy(() => import("./pages/MyAttendance"));
const MyProgress = lazy(() => import("./pages/MyProgress"));
const MemberClassBooking = lazy(() => import("./pages/MemberClassBooking"));
const MyPTSessions = lazy(() => import("./pages/MyPTSessions"));
const MyInvoices = lazy(() => import("./pages/MyInvoices"));
const MemberRequests = lazy(() => import("./pages/MemberRequests"));
const MemberStore = lazy(() => import("./pages/MemberStore"));
const MyWorkout = lazy(() => import("./pages/MyWorkout"));
const MyDiet = lazy(() => import("./pages/MyDiet"));
const MyBenefits = lazy(() => import("./pages/MyBenefits"));
const BookBenefitSlot = lazy(() => import("./pages/BookBenefitSlot"));
const MemberProfile = lazy(() => import("./pages/MemberProfile"));
const MemberFeedback = lazy(() => import("./pages/MemberFeedback"));
const MemberAnnouncements = lazy(() => import("./pages/MemberAnnouncements"));
const MemberReferrals = lazy(() => import("./pages/MemberReferrals"));

// Trainer-specific pages
const TrainerDashboard = lazy(() => import("./pages/TrainerDashboard"));
const MyClients = lazy(() => import("./pages/MyClients"));
const TrainerEarnings = lazy(() => import("./pages/TrainerEarnings"));
const ScheduleSession = lazy(() => import("./pages/ScheduleSession"));
const MealCatalogPage = lazy(() => import("./pages/MealCatalog"));

// Staff-specific pages
const StaffDashboard = lazy(() => import("./pages/StaffDashboard"));
const FollowUpCenter = lazy(() => import("./pages/FollowUpCenter"));

// Admin pages
const AdminRoles = lazy(() => import("./pages/AdminRoles"));
const DeviceManagement = lazy(() => import("./pages/DeviceManagement"));
const ApprovalQueue = lazy(() => import("./pages/ApprovalQueue"));
const DiscountCouponsPage = lazy(() => import("./pages/DiscountCoupons"));
const SystemHealthPage = lazy(() => import("./pages/SystemHealth"));
const DRReadinessPage = lazy(() => import("./pages/DRReadiness"));

// Profile
const ProfilePage = lazy(() => import("./pages/Profile"));

function PageLoader() {
  // Lightweight, non-blocking top progress bar.
  // The dumbbell loader is reserved for true app bootstrap (auth cold start),
  // not for in-app navigation or tab switches.
  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-50 h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-[progressSlide_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
      <style>{`@keyframes progressSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
    </div>
  );
}

const PUBLIC_PATHS = ["/", "/website-v1", "/ascent", "/privacy-policy", "/terms", "/terms-of-service", "/data-deletion", "/embed/lead-form", "/member/pay"];

const HowbodyLogin = lazy(() => import("./pages/HowbodyLogin"));
const HowbodyPublicReport = lazy(() => import("./pages/HowbodyPublicReport"));
const MyScanReport = lazy(() => import("./pages/MyScanReport"));

function PublicWhatsAppWidget() {
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.some(
    (p) => location.pathname === p || location.pathname.startsWith("/embed/")
  );
  if (!isPublic) return null;
  return <WhatsAppWidget />;
}

function RoutedContent() {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [isTransitionPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      setDisplayLocation(location);
    });
  }, [location, startTransition]);

  const isPending =
    isTransitionPending ||
    location.pathname !== displayLocation.pathname ||
    location.search !== displayLocation.search ||
    location.hash !== displayLocation.hash;

  return (
    <>
      <Suspense fallback={null}>
        <Routes location={displayLocation}>
          {/* Public Website — InclineAscent 3D experience */}
          <Route path="/" element={<InclineAscent />} />
          <Route path="/incline" element={<Navigate to="/" replace />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/terms-of-service" element={<TermsPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/set-password" element={<SetPasswordPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Embeddable lead form - no auth required */}
          <Route path="/embed/lead-form" element={<EmbedLeadForm />} />
          <Route path="/contract-sign/:token" element={<ContractSignPage />} />
          <Route path="/member/pay" element={<MemberCheckout />} />
          <Route path="/register" element={<PublicRegistrationPage />} />

          {/* Body scanner public flows (alias /scan-login is preferred; /howbody-login kept for legacy QR codes) */}
          <Route path="/scan-login" element={<HowbodyLogin />} />
          <Route path="/howbody-login" element={<HowbodyLogin />} />
          <Route path="/my-scan-report" element={<MyScanReport />} />
          <Route path="/reports/body/:token" element={<HowbodyPublicReport reportType="body" />} />
          <Route path="/reports/posture/:token" element={<HowbodyPublicReport reportType="posture" />} />

          {/* Smart Dashboard Redirect */}
          <Route path="/home" element={<ProtectedRoute><DashboardRedirect /></ProtectedRoute>} />

          {/* Profile - all authenticated roles */}
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

          {/* ==================== MEMBER ROUTES ==================== */}
          <Route path="/member-dashboard" element={<ProtectedRoute requiredRoles={['member']}><MemberDashboard /></ProtectedRoute>} />
          <Route path="/my-attendance" element={<ProtectedRoute requiredRoles={['member']}><MyAttendance /></ProtectedRoute>} />
          <Route path="/my-progress" element={<ProtectedRoute requiredRoles={['member']}><MyProgress /></ProtectedRoute>} />
          <Route path="/my-classes" element={<ProtectedRoute requiredRoles={['member']}><MemberClassBooking /></ProtectedRoute>} />
          <Route path="/my-pt-sessions" element={<ProtectedRoute requiredRoles={['member']}><MyPTSessions /></ProtectedRoute>} />
          <Route path="/pt-attendance" element={<ProtectedRoute requiredRoles={['owner','admin','manager','staff','trainer']}><PtAttendance /></ProtectedRoute>} />
          <Route path="/my-referrals" element={<ProtectedRoute requiredRoles={['member']}><MemberReferrals /></ProtectedRoute>} />
          <Route path="/my-invoices" element={<ProtectedRoute requiredRoles={['member']}><MyInvoices /></ProtectedRoute>} />
          <Route path="/my-requests" element={<ProtectedRoute requiredRoles={['member']}><MemberRequests /></ProtectedRoute>} />
          <Route path="/member-store" element={<ProtectedRoute requiredRoles={['member']}><MemberStore /></ProtectedRoute>} />
          <Route path="/member-announcements" element={<ProtectedRoute requiredRoles={['member']}><MemberAnnouncements /></ProtectedRoute>} />
          <Route path="/member-feedback" element={<ProtectedRoute requiredRoles={['member']}><MemberFeedback /></ProtectedRoute>} />
          <Route path="/my-workout" element={<ProtectedRoute requiredRoles={['member']}><MyWorkout /></ProtectedRoute>} />
          <Route path="/my-diet" element={<ProtectedRoute requiredRoles={['member']}><MyDiet /></ProtectedRoute>} />
          <Route path="/my-benefits" element={<ProtectedRoute requiredRoles={['member']}><MyBenefits /></ProtectedRoute>} />
          <Route path="/book-benefit" element={<ProtectedRoute requiredRoles={['member']}><BookBenefitSlot /></ProtectedRoute>} />
          <Route path="/member-profile" element={<ProtectedRoute requiredRoles={['member']}><MemberProfile /></ProtectedRoute>} />

          {/* ==================== TRAINER ROUTES ==================== */}
          <Route path="/trainer-dashboard" element={<ProtectedRoute requiredRoles={['trainer']}><TrainerDashboard /></ProtectedRoute>} />
          <Route path="/my-clients" element={<ProtectedRoute requiredRoles={['trainer']}><MyClients /></ProtectedRoute>} />
          <Route path="/trainer-earnings" element={<ProtectedRoute requiredRoles={['trainer']}><TrainerEarnings /></ProtectedRoute>} />
          <Route path="/schedule-session" element={<ProtectedRoute requiredRoles={['trainer']}><ScheduleSession /></ProtectedRoute>} />

          {/* ==================== STAFF ROUTES ==================== */}
          <Route path="/staff-dashboard" element={<ProtectedRoute requiredRoles={['staff']}><StaffDashboard /></ProtectedRoute>} />
          <Route path="/follow-up-center" element={<ProtectedRoute requiredRoles={['staff', 'manager', 'admin', 'owner']}><FollowUpCenter /></ProtectedRoute>} />

          {/* ==================== ADMIN/MANAGER/OWNER ROUTES ==================== */}
          <Route path="/dashboard" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><DashboardPage /></ProtectedRoute>} />
          <Route path="/members" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><MembersPage /></ProtectedRoute>} />
          <Route path="/leads" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><LeadsPage /></ProtectedRoute>} />
          <Route path="/plans" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><PlansPage /></ProtectedRoute>} />
          <Route path="/attendance" element={<Navigate to="/attendance-dashboard" replace />} />
          <Route path="/feedback" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><FeedbackPage /></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><InvoicesPage /></ProtectedRoute>} />
          <Route path="/payments" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><PaymentsPage /></ProtectedRoute>} />
          <Route path="/classes" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff', 'trainer']}><ClassesPage /></ProtectedRoute>} />
          <Route path="/pt-sessions" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer', 'staff']}><PTSessionsPage /></ProtectedRoute>} />
          {/* New plan creation flow */}
          <Route path="/fitness/create" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer']}><CreateModePickerPage /></ProtectedRoute>} />
          <Route path="/fitness/create/ai" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><CreateAIPage /></ProtectedRoute>} />
          <Route path="/fitness/create/manual" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer']}><CreateManualPage /></ProtectedRoute>} />
          <Route path="/fitness/create/manual/workout" element={<Navigate to="/fitness/create/manual?type=workout" replace />} />
          <Route path="/fitness/create/manual/diet" element={<Navigate to="/fitness/create/manual?type=diet" replace />} />
          <Route path="/fitness/preview/:planId" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer']}><PreviewPlanPage /></ProtectedRoute>} />
          {/* Trainers may view templates / member plans; AI Generate tab is hidden in-page for non-AI roles */}
          <Route path="/fitness/templates" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer']}><FitnessTemplatesPage /></ProtectedRoute>} />
          <Route path="/fitness/member-plans" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'trainer']}><FitnessMemberPlansPage /></ProtectedRoute>} />
          <Route path="/meal-catalog" element={<Navigate to="/fitness/meal-catalog" replace />} />
          <Route path="/fitness/meal-catalog" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><MealCatalogPage /></ProtectedRoute>} />

          {/* Legacy routes redirect to the new flow */}
          <Route path="/diet-workout-plans" element={<Navigate to="/fitness/create" replace />} />
          <Route path="/ai-fitness" element={<Navigate to="/fitness/create" replace />} />
          <Route path="/trainer-plan-builder" element={<Navigate to="/fitness/create" replace />} />
          <Route path="/inventory" element={<Navigate to="/products" replace />} />
          <Route path="/equipment" element={<Navigate to="/equipment-maintenance" replace />} />
          <Route path="/equipment-maintenance" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><EquipmentMaintenancePage /></ProtectedRoute>} />
          <Route path="/lockers" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><LockersPage /></ProtectedRoute>} />
          <Route path="/hrm" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><HRMPage /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><TasksPage /></ProtectedRoute>} />
          <Route path="/employees" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><EmployeesPage /></ProtectedRoute>} />
          <Route path="/trainers" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><TrainersPage /></ProtectedRoute>} />
          <Route path="/staff-attendance" element={<Navigate to="/attendance-dashboard" replace />} />
          <Route path="/attendance-dashboard" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff', 'trainer']}><AttendanceDashboardPage /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><AnalyticsPage /></ProtectedRoute>} />
          <Route path="/audit-logs" element={<ProtectedRoute requiredRoles={['owner', 'admin']}><AuditLogsPage /></ProtectedRoute>} />
          <Route path="/announcements" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff', 'trainer']}><AnnouncementsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff', 'trainer']}><SettingsPage /></ProtectedRoute>} />
          <Route path="/ai-control-center" element={<Navigate to="/settings?tab=ai-agent" replace />} />
          <Route path="/store" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><StorePage /></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><POSPage /></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><ReferralsPage /></ProtectedRoute>} />
          <Route path="/finance" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><FinancePage /></ProtectedRoute>} />
          <Route path="/my-plans" element={<ProtectedRoute><MemberPlansPage /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><ProductsPage /></ProtectedRoute>} />
          <Route path="/product-categories" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><ProductCategoriesPage /></ProtectedRoute>} />
          <Route path="/benefit-tracking" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><BenefitTrackingPage /></ProtectedRoute>} />
          <Route path="/all-bookings" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><AllBookingsPage /></ProtectedRoute>} />
          <Route path="/whatsapp-chat" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><WhatsAppChatPage /></ProtectedRoute>} />
          <Route path="/campaigns" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><Campaigns /></ProtectedRoute>} />
          <Route path="/contact-book" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager', 'staff']}><ContactBookPage /></ProtectedRoute>} />
          <Route path="/devices" element={<ProtectedRoute requiredRoles={['owner', 'admin']}><DeviceManagement /></ProtectedRoute>} />
          <Route path="/approvals" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><ApprovalQueue /></ProtectedRoute>} />
          <Route path="/discount-coupons" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><DiscountCouponsPage /></ProtectedRoute>} />
          {/* Admin user/role management */}
          <Route path="/admin-roles" element={<ProtectedRoute requiredRoles={['owner', 'admin']}><AdminRoles /></ProtectedRoute>} />
          <Route path="/system-health" element={<ProtectedRoute requiredRoles={['owner', 'admin']}><SystemHealthPage /></ProtectedRoute>} />
          <Route path="/dr-readiness" element={<ProtectedRoute requiredRoles={['owner', 'admin']}><DRReadinessPage /></ProtectedRoute>} />

          {/* Redirects for old routes */}
          <Route path="/admin/users" element={<Navigate to="/settings?tab=users" replace />} />
          <Route path="/branches" element={<Navigate to="/settings?tab=branches" replace />} />
          <Route path="/website-cms" element={<Navigate to="/settings?tab=website" replace />} />
          <Route path="/integrations" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><IntegrationsPage /></ProtectedRoute>} />
          <Route path="/integrations/webhooks" element={<ProtectedRoute requiredRoles={['owner', 'admin', 'manager']}><IntegrationWebhooksPage /></ProtectedRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      {isPending && <PageLoader />}
    </>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true }}>
        <AuthProvider>
          <BranchProvider>
          <DrBanner />
          <PublicWhatsAppWidget />
          <RoutedContent />
          </BranchProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
