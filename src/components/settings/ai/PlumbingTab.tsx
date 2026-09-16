// Plumbing — the technical underpinning of the AI Agent.
// Sub-tabs: Providers (LLM keys/models) · Tools (capability registry) · Logs (unified).
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Activity, Brain, Wrench } from 'lucide-react';
import { AIProvidersSettings } from '@/components/settings/AIProvidersSettings';
import { AILogsTab } from '@/components/settings/ai/AILogsTab';

export function PlumbingTab({ toolsPanel }: { toolsPanel: React.ReactNode }) {
  return (
    <Tabs defaultValue="providers" className="space-y-4">
      <TabsList className="grid grid-cols-3 w-full h-auto p-1">
        <TabsTrigger value="providers" className="text-xs sm:text-sm gap-1.5 py-2">
          <Brain className="h-3.5 w-3.5 hidden sm:block" /> Providers
        </TabsTrigger>
        <TabsTrigger value="tools" className="text-xs sm:text-sm gap-1.5 py-2">
          <Wrench className="h-3.5 w-3.5 hidden sm:block" /> Tools
        </TabsTrigger>
        <TabsTrigger value="logs" className="text-xs sm:text-sm gap-1.5 py-2">
          <Activity className="h-3.5 w-3.5 hidden sm:block" /> Logs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="providers">
        <AIProvidersSettings />
      </TabsContent>
      <TabsContent value="tools">
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50 p-4">{toolsPanel}</Card>
      </TabsContent>
      <TabsContent value="logs">
        <AILogsTab />
      </TabsContent>
    </Tabs>
  );
}
