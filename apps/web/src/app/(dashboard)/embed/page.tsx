import { EmbedSnippet } from './embed-snippet';
import { RegenerateKey } from './regenerate-key';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { requireShopSession } from '@/lib/auth';
import { env } from '@/lib/env';

export default async function EmbedPage() {
  const { shop } = await requireShopSession();
  const key = shop?.embed_key ?? 'YOUR_SHOP_KEY';
  const embedBase = env.NEXT_PUBLIC_EMBED_URL;

  const snippet = `<script src="${embedBase}/embed.js?key=${key}" async></script>\n<div id="quick3dquote"></div>`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Embed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste this snippet anywhere on your site. The widget fills its parent container.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your snippet</CardTitle>
        </CardHeader>
        <CardContent>
          <EmbedSnippet snippet={snippet} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform guides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Guide
            title="WordPress"
            description="Use a Custom HTML block on the page where you want the widget. Paste both lines, then save."
          />
          <Separator />
          <Guide
            title="Shopify"
            description={`Open Theme \u2192 Edit code. Find the template you want (often page.liquid) and paste both lines where the widget should appear.`}
          />
          <Separator />
          <Guide
            title="Webflow"
            description="Add an Embed element to the page, paste both lines, save, publish."
          />
          <Separator />
          <Guide
            title="Raw HTML"
            description="Paste anywhere inside the <body> tag. Wrap it in a div if you want to control max-width."
          />
        </CardContent>
      </Card>

      <Card className="border-error/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <RegenerateKey />
        </CardContent>
      </Card>
    </div>
  );
}

function Guide({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
