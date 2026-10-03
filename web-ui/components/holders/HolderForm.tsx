'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { holderSchema, HolderFormValues } from '@/lib/validation/holderSchema';
import { createHolder, updateHolder } from '@/app/holders/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { HolderPreview } from '@/components/holders/HolderPreview';
import { toast } from 'sonner';

interface HolderFormProps {
  initialData?: HolderFormValues & { id?: string };
  onCancel?: () => void;
  onComplete?: () => void;
}

export function HolderForm({ initialData, onCancel, onComplete }: HolderFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  
  const isEditing = !!initialData?.id;

  const form = useForm<HolderFormValues>({
    resolver: zodResolver(holderSchema),
    defaultValues: initialData || {
      name: '',
      type: 'weldon',
      taperType: 'cat40',
      gaugeLength: 0,
      diameter: 0,
      isActive: true,
    }
  });

  const onSubmit = (data: any) => {
    setError(null);
    startTransition(async () => {
      try {
        if (isEditing && initialData.id) {
          const res = await updateHolder(initialData.id, data);
          if (res?.error) {
            setError(res.error);
          } else {
            toast.success("Holder updated!");
            if (onComplete) {
              onComplete();
              return;
            }
            const returnUrl = searchParams.get('returnUrl');
            if (returnUrl) router.push(returnUrl);
            else router.push(`/holders/${initialData.id}`);
          }
        } else {
          const res = await createHolder(data);
          if (res?.error) {
            setError(res.error);
          } else {
            toast.success("Holder created!");
            if (onComplete) {
              onComplete();
              return;
            }
            const returnUrl = searchParams.get('returnUrl');
            if (returnUrl) router.push(returnUrl);
            else router.push(`/holders/${res.id}`);
          }
        }
      } catch (err: any) {
        setError(err.message || "Something went wrong.");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
      {/* Left Column: Form */}
      <Card className="shadow-md">
        <CardHeader className="border-b">
          <CardTitle>{isEditing ? 'Edit Holder' : 'Create New Holder'}</CardTitle>
          <CardDescription>
            {isEditing ? 'Update the details for this CNC tool holder.' : 'Define a new CNC tool holder to be used in assemblies.'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="p-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {error && (
              <div className="bg-destructive/20 text-destructive p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="name">Holder Name</Label>
                <Input id="name" {...form.register('name')} placeholder="e.g., BT40 ER32 Collet Chuck 70mm" />
                {form.formState.errors.name && <p className="text-destructive text-sm">{form.formState.errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Holder Type</Label>
                <Select 
                  onValueChange={(val) => form.setValue('type', val as any)} 
                  value={form.watch('type')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weldon">Weldon / Side Lock</SelectItem>
                    <SelectItem value="er_collet">ER Collet Chuck</SelectItem>
                    <SelectItem value="tg_collet">TG Collet Chuck</SelectItem>
                    <SelectItem value="shrink_fit">Shrink Fit</SelectItem>
                    <SelectItem value="hydraulic">Hydraulic Chuck</SelectItem>
                    <SelectItem value="shell_mill_arbor">Shell Mill Arbor</SelectItem>
                    <SelectItem value="drill_chuck">Drill Chuck</SelectItem>
                    <SelectItem value="tapping_chuck">Tapping Chuck</SelectItem>
                    <SelectItem value="custom">Custom / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Taper Type</Label>
                <Select 
                  onValueChange={(val) => form.setValue('taperType', val as any)} 
                  value={form.watch('taperType') || 'cat40'}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select taper" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cat40">CAT40</SelectItem>
                    <SelectItem value="cat50">CAT50</SelectItem>
                    <SelectItem value="bt30">BT30</SelectItem>
                    <SelectItem value="bt40">BT40</SelectItem>
                    <SelectItem value="bt50">BT50</SelectItem>
                    <SelectItem value="hsk63a">HSK-63A</SelectItem>
                    <SelectItem value="hsk100a">HSK-100A</SelectItem>
                    <SelectItem value="iso30">ISO30</SelectItem>
                    <SelectItem value="iso40">ISO40</SelectItem>
                    <SelectItem value="straight">Straight Shank</SelectItem>
                    <SelectItem value="morse">Morse Taper</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gaugeLength">Gauge Length (mm)</Label>
                <Input 
                  id="gaugeLength" 
                  type="number" step="0.1" 
                  {...form.register('gaugeLength', { valueAsNumber: true })} 
                />
                {form.formState.errors.gaugeLength && <p className="text-destructive text-sm">{form.formState.errors.gaugeLength.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="diameter">Body Diameter (mm)</Label>
                <Input 
                  id="diameter" 
                  type="number" step="0.1" 
                  {...form.register('diameter', { valueAsNumber: true })} 
                />
                {form.formState.errors.diameter && <p className="text-destructive text-sm">{form.formState.errors.diameter.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="shankSize">Shank Size (Inner Dia, mm)</Label>
                <Input 
                  id="shankSize" 
                  type="number" step="0.1" 
                  {...form.register('shankSize', { setValueAs: v => v === '' ? null : parseFloat(v) })} 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input id="manufacturer" {...form.register('manufacturer')} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Description & Notes</Label>
                <Textarea id="description" {...form.register('description')} className="h-24" />
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  if (onCancel) {
                    onCancel();
                    return;
                  }
                  const returnUrl = searchParams.get('returnUrl');
                  if (returnUrl) router.push(returnUrl);
                  else router.back();
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Save Changes' : 'Create Holder'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Right Column: Visual Preview */}
      <div className="lg:col-span-1 sticky top-6">
        <Card className="h-[600px] flex flex-col overflow-hidden shadow-md">
          <CardContent className="p-0 flex-1 relative min-h-0 overflow-hidden">
            <HolderPreview holderData={form.watch() as any} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
