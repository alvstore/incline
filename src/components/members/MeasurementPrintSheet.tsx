import { format } from 'date-fns';
import type { MemberMeasurementRecord } from '@/lib/measurements/types';

interface Props {
  memberName?: string;
  memberCode?: string;
  latest: MemberMeasurementRecord;
  history: MemberMeasurementRecord[];
  bmi?: string | null;
}

/**
 * Print-only measurement summary. Hidden on screen; the `print-sheet` class in
 * index.css makes it the only visible element during printing.
 */
export function MeasurementPrintSheet({ memberName, memberCode, latest, history, bmi }: Props) {
  const metrics: Array<[string, string]> = [
    ['Weight', latest.weight_kg ? `${latest.weight_kg} kg` : '--'],
    ['Height', latest.height_cm ? `${latest.height_cm} cm` : '--'],
    ['BMI', bmi || '--'],
    ['Body fat', latest.body_fat_percentage ? `${latest.body_fat_percentage} %` : '--'],
    ['Chest', latest.chest_cm ? `${latest.chest_cm} cm` : '--'],
    ['Waist', latest.waist_cm ? `${latest.waist_cm} cm` : '--'],
    ['Hips', latest.hips_cm ? `${latest.hips_cm} cm` : '--'],
    ['Abdomen', latest.abdomen_cm ? `${latest.abdomen_cm} cm` : '--'],
    ['Shoulders', latest.shoulder_cm ? `${latest.shoulder_cm} cm` : '--'],
  ];

  return (
    <div className="print-sheet hidden">
      <div className="p-8 text-slate-900">
        <div className="mb-6 border-b pb-4">
          <h1 className="text-xl font-bold">Measurement Summary</h1>
          <p className="text-sm">The Incline Life by Incline</p>
        </div>

        <div className="mb-6 text-sm">
          <p><strong>Member:</strong> {memberName || '--'}{memberCode ? ` (${memberCode})` : ''}</p>
          <p><strong>Recorded:</strong> {format(new Date(latest.recorded_at), 'dd MMM yyyy, h:mm a')}</p>
          <p><strong>Printed:</strong> {format(new Date(), 'dd MMM yyyy, h:mm a')}</p>
        </div>

        <table className="mb-6 w-full border-collapse text-sm">
          <tbody>
            {metrics.map(([label, value]) => (
              <tr key={label} className="border-b">
                <td className="py-1.5 pr-4 font-medium">{label}</td>
                <td className="py-1.5">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {history.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-bold">History</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-1.5 text-left">Date</th>
                  <th className="py-1.5 text-left">Weight</th>
                  <th className="py-1.5 text-left">Body fat</th>
                  <th className="py-1.5 text-left">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 6).map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-1.5">{format(new Date(m.recorded_at), 'dd MMM yyyy')}</td>
                    <td className="py-1.5">{m.weight_kg ? `${m.weight_kg} kg` : '--'}</td>
                    <td className="py-1.5">{m.body_fat_percentage ? `${m.body_fat_percentage} %` : '--'}</td>
                    <td className="py-1.5">{m.recorded_by_profile?.full_name || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
