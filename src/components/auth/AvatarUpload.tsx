import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { Loader2, Camera, User } from 'lucide-react';
import { uploadAndSyncPersonPhoto } from '@/lib/media/syncPersonPhoto';


export function AvatarUpload() {
  const { user, profile, refreshProfile } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please upload a JPEG, PNG, or WebP image');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB');
      return;
    }

    setIsUploading(true);

    try {
      // Single pipeline: compress → avatars → profile → biometric copy →
      // device sync queue (cron pushes to MIPS + gates within 5 min).
      const res = await uploadAndSyncPersonPhoto({
        file,
        userId: user.id,
        personName: profile?.full_name || 'User',
      });

      await refreshProfile();
      toast.success(
        res.queued
          ? 'Photo updated — queued for device sync'
          : 'Avatar updated successfully',
      );
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to upload avatar');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
          <AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.full_name ?? 'User'} />
          <AvatarFallback className="bg-accent text-accent-foreground text-xl font-semibold">
            {getInitials(profile?.full_name)}
          </AvatarFallback>
        </Avatar>
        <Button
          size="icon"
          variant="secondary"
          className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full shadow-md"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleUpload}
          className="hidden"
        />
      </div>
      <div className="text-center">
        <p className="font-medium">{profile?.full_name || 'User'}</p>
        <p className="text-sm text-muted-foreground">{profile?.email}</p>
      </div>
    </div>
  );
}