import { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { queueStaffSync } from '@/services/biometricService';
import { compressImageFile } from '@/utils/imageCompression';
import { uploadAndSyncPersonPhoto, type PersonEntity } from '@/lib/media/syncPersonPhoto';

interface StaffAvatarUploadProps {
  staffId?: string;
  /** Auth user id of the staff/trainer — enables the full biometric pipeline. */
  userId?: string;
  /** Which table `staffId` belongs to. */
  entityType?: PersonEntity;
  avatarUrl?: string;
  name: string;
  onAvatarChange: (url: string) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  bucket?: string;
}

export function StaffAvatarUpload({
  avatarUrl,
  name,
  staffId,
  userId,
  entityType = 'employees',
  onAvatarChange,
  size = 'md',
  disabled = false,
  bucket = 'avatars',
}: StaffAvatarUploadProps) {

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

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to storage
    setUploading(true);
    try {
      // Preferred path: full pipeline (avatar + private biometric copy +
      // device sync queue) whenever we know the owning auth user.
      if (userId) {
        const res = await uploadAndSyncPersonPhoto({
          file,
          userId,
          personName: name,
          person: staffId ? { entityType, entityId: staffId } : null,
        });
        onAvatarChange(res.avatarUrl);
        toast.success(res.queued ? 'Photo uploaded — queued for device sync' : 'Photo uploaded successfully');
        return;
      }

      // Fallback (record not linked to a login yet): plain avatar upload.
      const compressedFile = await compressImageFile(file);
      const fileName = `staff-${Date.now()}.jpg`;
      const filePath = `staff/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, compressedFile, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      onAvatarChange(publicUrl);
      toast.success('Photo uploaded successfully');

      if (staffId) {
        try {
          await queueStaffSync(staffId, publicUrl, name);
          toast.success('Photo queued for device sync');
        } catch (err) {
          console.warn('Biometric sync queue failed:', err);
        }
      }
    } catch (error: any) {
      toast.error('Failed to upload photo');
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
            {name?.charAt(0)?.toUpperCase() || 'S'}
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
          Click camera to upload
        </p>
      )}
    </div>
  );
}
