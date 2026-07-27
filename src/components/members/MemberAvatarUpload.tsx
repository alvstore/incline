import { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { queueMemberSync, syncAvatarToBiometric } from '@/services/biometricService';
import { compressImageFile } from '@/utils/imageCompression';
import { uploadBiometricPhoto } from '@/lib/media/biometricPhotoUrls';

interface MemberAvatarUploadProps {
  memberId?: string;
  avatarUrl?: string;
  name: string;
  userId?: string;
  onAvatarChange: (url: string) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function MemberAvatarUpload({
  avatarUrl,
  name,
  userId,
  memberId,
  onAvatarChange,
  size = 'md',
  disabled = false,
}: MemberAvatarUploadProps & { memberId?: string }) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'h-12 w-12',
    md: 'h-20 w-20',
    lg: 'h-32 w-32',
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      // Compress image for device compatibility (max 640x640, under 200KB)
      const compressedFile = await compressImageFile(file);

      // Public avatar (display) → kept in `avatars` bucket
      const fileName = `${userId || Date.now()}-${Date.now()}.jpg`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      onAvatarChange(publicUrl);

      // Persist avatar_url directly to profile so it becomes immediately visible
      // everywhere (AppHeader, MemberProfile, member lists) without relying on
      // the parent drawer to save. Idempotent, service-role not required.
      if (userId) {
        try {
          await supabase
            .from('profiles')
            .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
            .eq('id', userId);
        } catch (err) {
          console.warn('profiles.avatar_url update failed:', err);
        }
      }

      toast.success('Avatar uploaded successfully');

      // Biometric photo (private) → `member-photos` bucket via storage path on member.
      // The MIPS sync helper signs a fresh URL when pushing to the device, so we
      // never store stale public links for biometric usage.
      if (memberId) {
        try {
          const { path: biometricPath, signedUrl } = await uploadBiometricPhoto(
            'members',
            memberId,
            compressedFile,
          );
          // Persist both the storage path AND a public URL mirror on the
          // members row. The `_url` column feeds the self-heal trigger that
          // mirrors into profiles.avatar_url as a safety net for legacy paths.
          await supabase
            .from('members')
            .update({
              biometric_photo_path: biometricPath,
              biometric_photo_url: publicUrl,
            })
            .eq('id', memberId);
          await queueMemberSync(memberId, signedUrl, name);
          toast.success('Photo synced to member profile & queued for device');
        } catch (err) {
          console.warn('Biometric upload/queue failed:', err);
        }
      } else if (userId) {
        // No memberId yet (e.g. legacy callers) — keep avatar→biometric URL fallback.
        try {
          await syncAvatarToBiometric(userId, publicUrl);
        } catch (err) {
          console.warn('Avatar-to-biometric sync failed:', err);
        }
      }
    } catch (error: any) {
      toast.error('Failed to upload avatar');
      console.error('Upload error:', error);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
    }
  };

  const clearAvatar = () => {
    setPreviewUrl(null);
    onAvatarChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const displayUrl = previewUrl || avatarUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <Avatar className={sizeClasses[size]}>
          <AvatarImage src={displayUrl} alt={name} />
          <AvatarFallback className="text-lg bg-primary/10">
            {name?.charAt(0)?.toUpperCase() || 'M'}
          </AvatarFallback>
        </Avatar>
        
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-full">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {!disabled && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full shadow-md"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Camera className="h-4 w-4" />
          </Button>
        )}

        {displayUrl && !disabled && (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -top-1 -right-1 h-6 w-6 rounded-full shadow-md"
            onClick={clearAvatar}
            disabled={uploading}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
        disabled={disabled || uploading}
      />

      {!disabled && (
        <p className="text-xs text-muted-foreground text-center">
          Click camera to upload photo
        </p>
      )}
    </div>
  );
}