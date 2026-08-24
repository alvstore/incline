import { useState, useMemo } from "react";
import { format, isPast, isFuture, isToday, differenceInMinutes, addMinutes, isAfter, isBefore, startOfDay } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Plus, Users, Clock, CalendarDays, Check, X, UserX, Edit, Phone, User, Search, Filter, Dumbbell, Calendar, ClipboardList, Megaphone, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClasses, useClassBookings, useMarkAttendance, useCancelBooking } from "@/hooks/useClasses";
import { useTrainers } from "@/hooks/useTrainers";
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from "@/contexts/AuthContext";
import { AddClassDrawer } from "@/components/classes/AddClassDrawer";
import { EditClassDrawer } from "@/components/classes/EditClassDrawer";
import type { ClassWithDetails } from "@/services/classService";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import { LivePill } from "@/components/ui/live-pill";

type TimeFilter = "upcoming" | "past" | "all";

export default function ClassesPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { effectiveBranchId: branchId = '' } = useBranchContext();
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [classToEdit, setClassToEdit] = useState<ClassWithDetails | null>(null);
  const [rosterClassId, setRosterClassId] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [classTypeFilter, setClassTypeFilter] = useState<string>("all");
  const [trainerFilter, setTrainerFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const { data: classes, isLoading } = useClasses(branchId, { activeOnly: false });
  const { data: trainers } = useTrainers(branchId);
  const { data: bookings } = useClassBookings(selectedClass || "");
  const { data: rosterBookings } = useClassBookings(rosterClassId || "");
  const markAttendance = useMarkAttendance();
  const cancelBooking = useCancelBooking();

  useRealtimeInvalidate({
    channel: 'page-classes',
    tables: ['classes', 'class_bookings', 'class_waitlist'],
    invalidateKeys: [['classes'], ['class-bookings'], ['class-waitlist']],
  });

  const handleMarkAttendance = async (bookingId: string, attended: boolean) => {
    try {
      const result = await markAttendance.mutateAsync({ bookingId, attended });
      if (result.success) {
        toast.success(attended ? "Marked as attended" : "Marked as no-show");
      } else {
        toast.error(result.error || "Failed to mark attendance");
      }
    } catch (error) {
      toast.error("Failed to mark attendance");
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    try {
      const result = await cancelBooking.mutateAsync({ bookingId, reason: "Cancelled by staff" });
      if (result.success) {
        toast.success("Booking cancelled");
      } else {
        toast.error(result.error || "Failed to cancel booking");
      }
    } catch (error) {
      toast.error("Failed to cancel booking");
    }
  };

  const handleEditClass = (cls: ClassWithDetails) => {
    setClassToEdit(cls);
    setIsEditOpen(true);
  };

  /** Hand the class off to the Campaign Wizard, pre-seeded as an Event campaign. */
  const handleAnnounceClass = (classId: string) => {
    navigate(`/campaigns?announce_class=${classId}`);
  };


  // Get trainer info by ID
  const getTrainer = (trainerId: string | null) => {
    if (!trainerId) return null;
    return trainers?.find((t: any) => t.id === trainerId);
  };

  const getTrainerName = (trainerId: string | null) => {
    const trainer = getTrainer(trainerId);
    return trainer?.profile_name || trainer?.profile_email || null;
  };

  /** Staff trainer name, or the freelance/guest instructor typed on the class. */
  const getClassInstructor = (cls: ClassWithDetails): { name: string | null; isGuest: boolean } => {
    const staffName = getTrainerName(cls.trainer_id);
    if (staffName) return { name: staffName, isGuest: false };
    const guest = ((cls as any).external_trainer_name || '').trim();
    return { name: guest || null, isGuest: !!guest };
  };

  const getTrainerPhone = (trainerId: string | null) => {
    const trainer = getTrainer(trainerId);
    return trainer?.profile_phone;
  };

  const getTrainerAvatar = (trainerId: string | null) => {
    const trainer = getTrainer(trainerId);
    return trainer?.profile_avatar;
  };


  // Filter classes by time period
  const filteredByTime = useMemo(() => {
    const now = new Date();
    return (classes || []).filter(cls => {
      const scheduledAt = new Date(cls.scheduled_at);
      const endTime = addMinutes(scheduledAt, cls.duration_minutes || 60);
      
      if (timeFilter === "upcoming") {
        return isAfter(endTime, now); // Not yet ended
      } else if (timeFilter === "past") {
        return isBefore(endTime, now); // Already ended
      }
      return true; // "all"
    });
  }, [classes, timeFilter]);

  // Filter classes by search and other filters
  const filteredClasses = useMemo(() => {
    return filteredByTime.filter(cls => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery ||
        cls.name.toLowerCase().includes(q) ||
        cls.description?.toLowerCase().includes(q) ||
        ((cls as any).venue || '').toLowerCase().includes(q) ||
        (getClassInstructor(cls).name || '').toLowerCase().includes(q);

      const matchesType = classTypeFilter === "all" || cls.class_type === classTypeFilter;
      const matchesTrainer =
        trainerFilter === "all"
          ? true
          : trainerFilter === "guest"
            ? !cls.trainer_id && !!(cls as any).external_trainer_name
            : cls.trainer_id === trainerFilter;

      
      return matchesSearch && matchesType && matchesTrainer;
    }).sort((a, b) => {
      // For upcoming, sort by nearest first; for past, sort by most recent first
      const dateA = new Date(a.scheduled_at).getTime();
      const dateB = new Date(b.scheduled_at).getTime();
      return timeFilter === "past" ? dateB - dateA : dateA - dateB;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredByTime, searchQuery, classTypeFilter, trainerFilter, timeFilter]);

  // Get class status badge
  const getClassStatus = (cls: ClassWithDetails) => {
    const now = new Date();
    const scheduledAt = new Date(cls.scheduled_at);
    const endTime = addMinutes(scheduledAt, cls.duration_minutes || 60);

    if (!cls.is_active) {
      return { label: "Cancelled", variant: "destructive" as const, color: "bg-destructive/10 text-destructive border-destructive/30" };
    }
    if (isPast(endTime)) {
      return { label: "Completed", variant: "secondary" as const, color: "bg-muted text-muted-foreground" };
    }
    if (isPast(scheduledAt) && isFuture(endTime)) {
      return { label: "In Progress", variant: "default" as const, color: "bg-primary/10 text-primary border-primary/30" };
    }
    if (isToday(scheduledAt)) {
      const minsUntil = differenceInMinutes(scheduledAt, now);
      if (minsUntil <= 60 && minsUntil > 0) {
        return { label: `Starts in ${minsUntil}m`, variant: "default" as const, color: "bg-warning/10 text-warning border-warning/30" };
      }
      return { label: "Today", variant: "outline" as const, color: "bg-success/10 text-success border-success/30" };
    }
    return { label: "Upcoming", variant: "outline" as const, color: "bg-info/10 text-info border-info/30" };
  };

  // Get capacity percentage
  const getCapacityPercentage = (cls: ClassWithDetails) => {
    const bookedCount = cls.bookings_count || 0;
    return Math.min((bookedCount / cls.capacity) * 100, 100);
  };

  const selectedClassData = filteredClasses.find((c) => c.id === selectedClass);

  // Unique class types for filter
  const classTypes = [...new Set((classes || []).map(c => c.class_type).filter(Boolean))];

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const upcoming = (classes || []).filter(cls => isAfter(addMinutes(new Date(cls.scheduled_at), cls.duration_minutes || 60), now) && cls.is_active);
    const todayClasses = upcoming.filter(cls => isToday(new Date(cls.scheduled_at)));
    const totalBookings = upcoming.reduce((acc, cls) => acc + (cls.bookings_count || 0), 0);
    return { upcoming: upcoming.length, today: todayClasses.length, totalBookings };
  }, [classes]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Classes</h1>
              <LivePill />
            </div>
            <p className="text-muted-foreground">Manage group classes and bookings</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Branch selector moved to global header */}
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Class
            </Button>
          </div>
        </div>

        <AddClassDrawer open={isCreateOpen} onOpenChange={setIsCreateOpen} branchId={branchId} />
        <EditClassDrawer 
          open={isEditOpen} 
          onOpenChange={setIsEditOpen} 
          classData={classToEdit}
          branchId={branchId}
        />

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                Upcoming Classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.upcoming}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-success" />
                Today's Classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">{stats.today}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-warning" />
                Total Bookings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalBookings}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-info/10 to-info/5 border-info/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4 text-info" />
                Active Trainers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{trainers?.filter((t: any) => t.is_active).length || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Time Filter Tabs + Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Time Period Tabs */}
              <div className="flex items-center gap-2">
                <Button
                  variant={timeFilter === "upcoming" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeFilter("upcoming")}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Upcoming
                </Button>
                <Button
                  variant={timeFilter === "past" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeFilter("past")}
                >
                  Past
                </Button>
                <Button
                  variant={timeFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeFilter("all")}
                >
                  All
                </Button>
              </div>
              
              {/* Search and Filters */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search classes or trainers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={classTypeFilter} onValueChange={setClassTypeFilter}>
                  <SelectTrigger className="w-[150px]">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Class Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {classTypes.map(type => (
                      <SelectItem key={type} value={type!}>
                        {type!.charAt(0).toUpperCase() + type!.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={trainerFilter} onValueChange={setTrainerFilter}>
                  <SelectTrigger className="w-[180px]">
                    <User className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Trainer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Trainers</SelectItem>
                    <SelectItem value="guest">Guest / freelance</SelectItem>
                    {trainers?.map((trainer: any) => (
                      <SelectItem key={trainer.id} value={trainer.id}>
                        {trainer.profile_name || trainer.profile_email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="schedule" className="space-y-4">
          <TabsList>
            <TabsTrigger value="schedule">Schedule ({filteredClasses.length})</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
          </TabsList>

          <TabsContent value="schedule" className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading classes...</div>
            ) : filteredClasses.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    {searchQuery || classTypeFilter !== "all" || trainerFilter !== "all" 
                      ? "No classes match your filters." 
                      : timeFilter === "upcoming" 
                        ? "No upcoming classes scheduled."
                        : "No classes found."}
                  </p>
                  {timeFilter === "upcoming" && (
                    <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Schedule a Class
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredClasses.map((cls) => {
                  const status = getClassStatus(cls);
                  const instructor = getClassInstructor(cls);
                  const trainerName = instructor.name;
                  const trainerPhone = instructor.isGuest ? null : getTrainerPhone(cls.trainer_id);
                  const trainerAvatar = instructor.isGuest ? undefined : getTrainerAvatar(cls.trainer_id);
                  const capacityPercent = getCapacityPercentage(cls);
                  const bookedCount = cls.bookings_count || 0;
                  const bannerUrl = (cls as any).banner_url as string | null;
                  const venue = (cls as any).venue as string | null;

                  return (
                    <Card
                      key={cls.id}
                      className={`cursor-pointer overflow-hidden rounded-2xl transition-all duration-200 hover:shadow-xl hover:shadow-primary/10 group ${
                        selectedClass === cls.id ? "border-primary ring-2 ring-primary/20" : ""
                      } ${!cls.is_active ? "opacity-60" : ""}`}
                      onClick={() => setSelectedClass(cls.id)}
                    >
                      {/* Banner / poster */}
                      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10">
                        {bannerUrl ? (
                          <img
                            src={bannerUrl}
                            alt={`${cls.name} poster`}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Dumbbell className="h-10 w-10 text-primary/40" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
                          <Badge className={`text-xs ${status.color}`}>{status.label}</Badge>
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 w-9 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); handleAnnounceClass(cls.id); }}
                              aria-label={`Announce ${cls.name}`}
                              title="Announce this class"
                            >
                              <Megaphone className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 w-9 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); setRosterClassId(cls.id); }}
                              aria-label={`View attendees of ${cls.name}`}
                              title="View Attendees"
                            >
                              <ClipboardList className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 w-9 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); handleEditClass(cls); }}
                              aria-label={`Edit ${cls.name}`}
                              title="Edit Class"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-lg truncate">{cls.name}</CardTitle>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {cls.class_type && (
                                <Badge variant="secondary" className="text-xs">
                                  {cls.class_type.charAt(0).toUpperCase() + cls.class_type.slice(1)}
                                </Badge>
                              )}
                              {venue && (
                                <Badge variant="outline" className="text-xs">
                                  <MapPin className="mr-1 h-3 w-3" />{venue}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {cls.description && (
                          <CardDescription className="line-clamp-2 mt-1">{cls.description}</CardDescription>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-4">
                        {/* Date & Time */}
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                            <span>{format(new Date(cls.scheduled_at), "MMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>{format(new Date(cls.scheduled_at), "h:mm a")}</span>
                          </div>
                        </div>

                        {/* Capacity Progress */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Capacity</span>
                            <span className={`font-medium ${bookedCount >= cls.capacity ? "text-destructive" : ""}`}>
                              {bookedCount}/{cls.capacity} booked
                            </span>
                          </div>
                          <Progress value={capacityPercent} className="h-2" />
                          {(cls.waitlist_count || 0) > 0 && (
                            <p className="text-xs text-muted-foreground">{cls.waitlist_count} on waitlist</p>
                          )}
                        </div>

                        {/* Trainer Card */}
                        {trainerName ? (
                          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={trainerAvatar} />
                              <AvatarFallback className="bg-primary/10 text-primary text-sm">
                                {trainerName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate flex items-center gap-1.5">
                                {trainerName}
                                {instructor.isGuest && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Guest</Badge>
                                )}
                              </p>
                              {trainerPhone && (
                                <a 
                                  href={`tel:${trainerPhone}`} 
                                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Phone className="h-3 w-3" />
                                  {trainerPhone}
                                </a>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-dashed">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <User className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <p className="text-sm text-muted-foreground">No trainer assigned</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="attendance" className="space-y-4">
            {selectedClass && selectedClassData ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{selectedClassData.name} - Attendance</CardTitle>
                      <CardDescription>
                        {format(new Date(selectedClassData.scheduled_at), "PPP p")}
                        {getTrainerName(selectedClassData.trainer_id) && (
                          <span className="ml-2">• Trainer: {getTrainerName(selectedClassData.trainer_id)}</span>
                        )}
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleEditClass(selectedClassData)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Class
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {bookings?.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">No bookings for this class</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bookings?.map((booking) => (
                          <TableRow key={booking.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={(booking as any).member_avatar} />
                                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                    {booking.member_name?.charAt(0) || 'M'}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{booking.member_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {booking.member_phone ? (
                                <a href={`tel:${booking.member_phone}`} className="text-primary hover:underline flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {booking.member_phone}
                                </a>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  booking.status === "attended"
                                    ? "default"
                                    : booking.status === "no_show"
                                    ? "destructive"
                                    : booking.status === "cancelled"
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {booking.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {booking.status === "booked" && (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleMarkAttendance(booking.id, true)}
                                    title="Mark as attended"
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleMarkAttendance(booking.id, false)}
                                    title="Mark as no-show"
                                  >
                                    <UserX className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleCancelBooking(booking.id)}
                                    title="Cancel booking"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Select a class from the schedule to view attendance
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Attendees Roster Drawer */}
      <Sheet open={!!rosterClassId} onOpenChange={(open) => !open && setRosterClassId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              Class Attendees
            </SheetTitle>
            <SheetDescription>
              {rosterClassId && filteredClasses.find(c => c.id === rosterClassId)?.name} — {rosterClassId && filteredClasses.find(c => c.id === rosterClassId)?.scheduled_at && format(new Date(filteredClasses.find(c => c.id === rosterClassId)!.scheduled_at), 'PPP p')}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {(!rosterBookings || rosterBookings.length === 0) ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>No bookings for this class yet</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
                  <span>{rosterBookings.length} booking(s)</span>
                  <span>{rosterBookings.filter(b => b.status === 'attended').length} attended</span>
                </div>
                {rosterBookings.map((booking) => (
                  <div key={booking.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={(booking as any).member_avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                        {booking.member_name?.charAt(0) || 'M'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{booking.member_name}</p>
                      {booking.member_phone ? (
                        <a href={`tel:${booking.member_phone}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {booking.member_phone}
                        </a>
                      ) : (
                        <p className="text-xs text-muted-foreground">No phone</p>
                      )}
                    </div>
                    <Badge
                      variant={
                        booking.status === 'attended' ? 'default' :
                        booking.status === 'no_show' ? 'destructive' :
                        booking.status === 'cancelled' ? 'outline' :
                        'secondary'
                      }
                      className="text-xs"
                    >
                      {booking.status}
                    </Badge>
                  </div>
                ))}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
