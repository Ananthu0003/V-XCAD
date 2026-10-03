import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Upload } from 'lucide-react';

export default function ImportExportPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import & Export</h1>
        <p className="text-muted-foreground mt-2">
          Backup or transfer your tool library as JSON data.
        </p>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Export Tool Library</CardTitle>
            <CardDescription>Download all your active tools and holders as a JSON file.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/export" method="GET">
              <Button type="submit" className="w-full">
                <Download className="mr-2 h-4 w-4" /> Export to JSON
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import Tool Library</CardTitle>
            <CardDescription>Upload a previously exported JSON file to restore your tools.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="grid w-full max-w-sm items-center gap-1.5">
                <input 
                  type="file" 
                  accept=".json"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" 
                />
              </div>
              <Button type="button" variant="outline" disabled className="w-full">
                <Upload className="mr-2 h-4 w-4" /> Import from JSON
              </Button>
              <p className="text-xs text-muted-foreground text-center">Import is currently disabled for safety.</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
