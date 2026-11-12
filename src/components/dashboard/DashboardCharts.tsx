import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { Clock, AlertTriangle, CheckCircle, ClipboardList, IndianRupee } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { clickOnActivateKey } from '@/lib/a11y/clickable';
interface ChartData {
  name: string;
  value: number;
  [key: string]: any;
}

interface RevenueChartProps {
  data: ChartData[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <Card className="shadow-lg shadow-primary/10 rounded-2xl border-0">
      <CardHeader>
        <CardTitle className="text-lg">Revenue Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={300} debounce={50}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" className="text-xs fill-muted-foreground" />
              <YAxis className="text-xs fill-muted-foreground" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface AttendanceChartProps {
  data: ChartData[];
}

export function AttendanceChart({ data }: AttendanceChartProps) {
  return (
    <Card className="shadow-lg shadow-primary/10 rounded-2xl border-0">
      <CardHeader>
        <CardTitle className="text-lg">Weekly Attendance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={300} debounce={50}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" className="text-xs fill-muted-foreground" />
              <YAxis className="text-xs fill-muted-foreground" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Bar dataKey="checkins" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface MembershipDistributionProps {
  data: ChartData[];
}

const PLAN_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--info))',
  'hsl(var(--destructive))',
];

export function MembershipDistribution({ data }: MembershipDistributionProps) {
  const total = data?.reduce((sum, d) => sum + d.value, 0) || 0;

  if (!data || data.length === 0) {
    return (
      <Card className="shadow-lg rounded-2xl border-0">
        <CardHeader>
          <CardTitle className="text-lg">Membership Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2">
            <p>No active memberships</p>
            <Badge variant="outline" className="text-xs">Add plans to see distribution</Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg rounded-2xl border-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Membership Distribution</CardTitle>
          <div className="text-right">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground">Active Members</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stacked bar */}
        <div className="h-4 rounded-full overflow-hidden bg-muted flex">
          {data.map((plan, i) => {
            const pct = total > 0 ? (plan.value / total) * 100 : 0;
            return (
              <div
                key={plan.name}
                className="h-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: PLAN_COLORS[i % PLAN_COLORS.length],
                  minWidth: pct > 0 ? '8px' : '0',
                }}
              />
            );
          })}
        </div>

        {/* Plan breakdown */}
        <div className="space-y-3">
          {data.map((plan, i) => {
            const pct = total > 0 ? ((plan.value / total) * 100).toFixed(0) : '0';
            return (
              <div key={plan.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: PLAN_COLORS[i % PLAN_COLORS.length] }}
                  />
                  <span className="text-sm font-medium truncate max-w-[180px]">{plan.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{plan.value}</span>
                  <Badge variant="secondary" className="text-xs min-w-[48px] justify-center">
                    {pct}%
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Hourly Attendance Chart
interface HourlyAttendanceChartProps {
  data: { hour: string; checkins: number }[];
}

export function HourlyAttendanceChart({ data }: HourlyAttendanceChartProps) {
  const hasData = data.some(d => d.checkins > 0);

  return (
    <Card className="shadow-lg shadow-primary/10 rounded-2xl border-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5 text-accent" />
          Today's Check-ins by Hour
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            No check-ins recorded today
          </div>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%" minHeight={200} debounce={50}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" className="text-xs fill-muted-foreground" tick={{ fontSize: 10 }} />
                <YAxis className="text-xs fill-muted-foreground" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="checkins" 
                  stroke="hsl(var(--success))" 
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--success))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Accounts Receivable Widget (replaces Revenue Snapshot)
interface AccountsReceivableWidgetProps {
  data: { id: string; memberName: string; memberCode: string; owed: number; status: string }[];
  totalOutstanding: number;
}

export function AccountsReceivableWidget({ data, totalOutstanding }: AccountsReceivableWidgetProps) {
  const navigate = useNavigate();

  return (
    <Card className="shadow-lg rounded-2xl border-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <IndianRupee className="h-5 w-5 text-destructive" />
          Accounts Receivable
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="bg-destructive/10 rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">Total Outstanding</p>
          <p className="text-2xl font-bold text-destructive">₹{totalOutstanding.toLocaleString()}</p>
        </div>
        {data.length === 0 ? (
          <div className="flex items-center gap-2 text-success text-sm py-4 justify-center">
            <CheckCircle className="h-4 w-4" />
            No pending dues
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((member) => (
              <div role="button" tabIndex={0} onKeyDown={clickOnActivateKey}
                key={member.id}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => navigate('/invoices')}
              >
                <div>
                  <p className="text-sm font-medium">{member.memberName}</p>
                  <p className="text-xs text-muted-foreground">{member.memberCode}</p>
                </div>
                <Badge variant={member.status === 'overdue' ? 'destructive' : 'secondary'} className="text-xs">
                  ₹{member.owed.toLocaleString()}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
// Expiring Members Widget
interface ExpiringMembersWidgetProps {
  data: { memberId: string; memberCode: string; memberName: string; hoursRemaining: number; planName: string }[];
}

export function ExpiringMembersWidget({ data }: ExpiringMembersWidgetProps) {
  const navigate = useNavigate();

  return (
    <Card className="shadow-lg shadow-primary/10 rounded-2xl border-0 border-l-4 border-l-destructive">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Expiring in 48 Hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center gap-2 text-success text-sm py-4">
            <CheckCircle className="h-4 w-4" />
            No memberships expiring soon
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((member, idx) => (
              <div role="button" tabIndex={0} onKeyDown={clickOnActivateKey} 
                key={idx} 
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => navigate('/members')}
              >
                <div>
                  <p className="text-sm font-medium">{member.memberName}</p>
                  <p className="text-xs text-muted-foreground">{member.planName}</p>
                </div>
                <Badge variant="destructive" className="text-xs">
                  {member.hoursRemaining}h left
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Pending Approvals Widget
interface PendingApprovalsWidgetProps {
  count: number;
}

export function PendingApprovalsWidget({ count }: PendingApprovalsWidgetProps) {
  const navigate = useNavigate();

  return (
    <Card role="button" tabIndex={0} onKeyDown={clickOnActivateKey} 
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-lg shadow-primary/10 rounded-2xl border-0 cursor-pointer hover:shadow-xl transition-shadow"
      onClick={() => navigate('/approvals')}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Pending Approvals</p>
            <p className="text-2xl font-bold">{count}</p>
          </div>
          <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
            <ClipboardList className="h-6 w-6 text-warning" />
          </div>
        </div>
        {count === 0 ? (
          <p className="text-xs text-success mt-2 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            All caught up!
          </p>
        ) : (
          <p className="text-xs text-warning mt-2">Click to review</p>
        )}
      </CardContent>
    </Card>
  );
}
