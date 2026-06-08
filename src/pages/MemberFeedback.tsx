import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, MessageSquare, Send, CheckCircle, Clock, AlertCircle, Globe, HeartHandshake } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { toast } from 'sonner';
import { format } from 'date-fns';

const FEEDBACK_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'facility', label: 'Facility' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'trainer', label: 'Trainer' },
  { value: 'staff', label: 'Staff' },
  { value: 'classes', label: 'Classes' },
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'suggestion', label: 'Suggestion' },
];

export default function MemberFeedback() {
  const { member, isLoading: memberLoading } = useMemberData();
  const queryClient = useQueryClient();
  
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [category, setCategory] = useState('general');
  const [feedbackText, setFeedbackText] = useState('');
  const [consentTestimonial, setConsentTestimonial] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<{ id: string; rating: number } | null>(null);

  // Branch Google review link (for the post-submit CTA)
  const { data: branchInfo } = useQuery({
    queryKey: ['branch-google-link', member?.branch_id],
    enabled: !!member?.branch_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('branches')
        .select('name, google_review_link')
        .eq('id', member!.branch_id)
        .maybeSingle();
      return data;
    },
  });

  // Fetch member's previous feedback
  const { data: myFeedback = [], isLoading: feedbackLoading } = useQuery({
    queryKey: ['my-feedback', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feedback')
        .select('*')
        .eq('member_id', member!.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Submit feedback mutation
  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!member) throw new Error('Member not found');

      const { data, error } = await supabase
        .from('feedback')
        .insert({
          member_id: member.id,
          branch_id: member.branch_id,
          rating,
          category,
          feedback_text: feedbackText || null,
          status: 'pending',
          consent_for_testimonial: consentTestimonial,
          consent_for_testimonial_at: consentTestimonial ? new Date().toISOString() : null,
        })
        .select('id, rating')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Thank you for your feedback!');
      setLastSubmission({ id: data!.id, rating: data!.rating });
      setRating(5);
      setCategory('general');
      setFeedbackText('');
      setConsentTestimonial(false);
      queryClient.invalidateQueries({ queryKey: ['my-feedback'] });

      // Fire-and-forget: server-side request for ratings >= 4 so a Google
      // review ask goes out via the member's preferred channel too.
      if (data && data.rating >= 4) {
        supabase.functions.invoke('request-google-review', {
          body: { feedback_id: data.id },
        }).catch(() => { /* silent — UI CTA still available */ });
      }
    },
    onError: (error) => {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback. Please try again.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      toast.error('Please select a rating');
      return;
    }
    submitFeedback.mutate();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-warning/10 text-warning"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'reviewed':
        return <Badge className="bg-info/10 text-info"><MessageSquare className="w-3 h-3 mr-1" />Reviewed</Badge>;
      case 'resolved':
        return <Badge className="bg-success/10 text-success"><CheckCircle className="w-3 h-3 mr-1" />Resolved</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4) return 'text-success';
    if (rating >= 3) return 'text-warning';
    return 'text-destructive';
  };

  if (memberLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <Card className="max-w-md mx-auto mt-8">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Member Profile Found</h2>
            <p className="text-muted-foreground">
              Your account is not linked to a member profile.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Feedback</h1>
          <p className="text-muted-foreground">Share your experience and help us improve</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Submit Feedback Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Submit Feedback
              </CardTitle>
              <CardDescription>
                We value your opinion! Let us know how we can serve you better.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Star Rating */}
                <div className="space-y-2">
                  <Label>How would you rate your experience?</Label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        className="p-1 transition-transform hover:scale-110"
                      >
                        <Star
                          className={`h-8 w-8 transition-colors ${
                            star <= (hoverRating || rating)
                              ? 'fill-warning text-warning'
                              : 'text-muted-foreground'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 text-sm text-muted-foreground">
                      {rating} / 5
                    </span>
                  </div>
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Feedback Text */}
                <div className="space-y-2">
                  <Label htmlFor="feedback">Your Feedback (Optional)</Label>
                  <Textarea
                    id="feedback"
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Tell us more about your experience..."
                    rows={4}
                  />
                </div>

                {/* Testimonial consent */}
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
                  <Checkbox
                    id="consent-testimonial"
                    checked={consentTestimonial}
                    onCheckedChange={(v) => setConsentTestimonial(Boolean(v))}
                    className="mt-0.5"
                  />
                  <Label htmlFor="consent-testimonial" className="text-sm leading-snug font-normal cursor-pointer">
                    I agree my feedback can be used as a public testimonial (with my first name only).
                    You can withdraw consent anytime by contacting the front desk.
                  </Label>
                </div>

                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={submitFeedback.isPending}
                >
                  {submitFeedback.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Submit Feedback
                    </>
                  )}
                </Button>
              </form>

              {lastSubmission && lastSubmission.rating >= 4 && branchInfo?.google_review_link && (
                <div className="mt-4 rounded-xl border border-success/25 bg-success/10 p-4">
                  <div className="flex items-start gap-3">
                    <Globe className="h-5 w-5 text-success mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-success">Loved it? Help others find us</p>
                      <p className="text-sm text-success/80 mt-0.5">
                        A quick Google review takes 30 seconds and means the world to {branchInfo.name}.
                      </p>
                      <Button
                        size="sm"
                        className="mt-3 bg-success hover:bg-success"
                        onClick={() => window.open(branchInfo.google_review_link!, '_blank', 'noopener')}
                      >
                        Leave a Google review
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {lastSubmission && lastSubmission.rating <= 3 && (
                <div className="mt-4 rounded-xl border border-warning/25 bg-warning/10 p-4">
                  <div className="flex items-start gap-3">
                    <HeartHandshake className="h-5 w-5 text-warning mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-warning">Thank you — we hear you</p>
                      <p className="text-sm text-warning/80 mt-0.5">
                        A manager will reach out shortly to make this right.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Previous Feedback */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                My Previous Feedback
              </CardTitle>
              <CardDescription>
                View your submitted feedback and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {feedbackLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : myFeedback.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>You haven't submitted any feedback yet.</p>
                  <p className="text-sm mt-1">Share your experience with us!</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[400px] overflow-y-auto">
                  {myFeedback.map((feedback: any) => (
                    <div
                      key={feedback.id}
                      className="p-4 border rounded-lg space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className={`flex items-center gap-1 ${getRatingColor(feedback.rating)}`}>
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              className={`h-4 w-4 ${
                                i < feedback.rating ? 'fill-current' : 'text-muted'
                              }`}
                            />
                          ))}
                        </div>
                        {getStatusBadge(feedback.status)}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {feedback.category}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(feedback.created_at), 'dd MMM yyyy')}
                        </span>
                      </div>
                      
                      {feedback.feedback_text && (
                        <p className="text-sm text-muted-foreground">
                          {feedback.feedback_text}
                        </p>
                      )}
                      
                      {feedback.admin_notes && (
                        <div className="bg-muted/50 p-3 rounded-md">
                          <p className="text-xs font-medium mb-1">Response:</p>
                          <p className="text-sm">{feedback.admin_notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
