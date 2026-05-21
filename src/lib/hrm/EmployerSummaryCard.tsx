import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Building2, ExternalLink, AlertTriangle } from 'lucide-react';
import { getEmployerProfile } from './getEmployerProfile';

interface Props {
  branchId: string | null;
}

export default function EmployerSummaryCard({ branchId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['employer-profile', branchId],
    queryFn: () => getEmployerProfile(branchId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;

  const p = data;
  const missing: string[] = [];
  if (!p?.legal_name) missing.push('Legal name');
  if (!p?.full_address) missing.push('Address');
  if (!p?.gstin) missing.push('GSTIN');
  if (!p?.phone) missing.push('Phone');
  if (!p?.email) missing.push('Email');

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-indigo-600" /> Employer details
          </CardTitle>
          <CardDescription>
            Used on contracts, payslips, GST invoices and policy headers. Pulled from your branch
            record — edit there to update everywhere at once.
          </CardDescription>
        </div>
        <Link to="/branches">
          <Button size="sm" variant="outline" className="rounded-xl">
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Edit in Branches
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="Legal name" value={p?.legal_name} />
        <Row label="Proprietor" value={p?.proprietor_name} hrm />
        <Row label="GSTIN" value={p?.gstin} mono />
        <Row label="PAN" value={p?.pan} mono hrm />
        <Row label="Firm registration no." value={p?.firm_registration_no} hrm />
        <Row label="Phone" value={p?.phone} />
        <Row label="Email" value={p?.email} />
        <Row label="Address" value={p?.full_address} className="md:col-span-2" />
        {missing.length > 0 && (
          <div className="md:col-span-2 mt-2 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800 text-xs">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Incomplete on branch:</strong> {missing.join(', ')}. Contracts and invoices
              will print blanks until these are filled.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
  hrm,
  className,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  hrm?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        {label}
        {hrm && <span className="text-[10px] font-normal text-indigo-500 normal-case">HR-only</span>}
      </div>
      <div className={`mt-0.5 ${mono ? 'font-mono' : ''} text-slate-900`}>
        {value || <span className="text-slate-400 italic">—</span>}
      </div>
    </div>
  );
}
