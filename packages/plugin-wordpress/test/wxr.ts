export interface TestItem {
  readonly id: number;
  readonly type?: string;
  readonly status?: string;
  readonly title?: string;
  readonly slug?: string;
  readonly link?: string;
  readonly content?: string;
  /** `post_date`, in the site's zone. */
  readonly date?: string;
  readonly dateGmt?: string;
  readonly modifiedGmt?: string;
  readonly guid?: string;
  readonly creator?: string;
  readonly password?: string;
  readonly parent?: number;
  readonly attachmentUrl?: string;
  readonly terms?: readonly { taxonomy: string; slug: string; name: string }[];
  readonly meta?: readonly { key: string; value: string }[];
  readonly comments?: readonly TestComment[];
}

export interface TestComment {
  readonly id: number;
  readonly parent?: number;
  readonly type?: string;
  readonly approved?: string;
  readonly author?: string;
  readonly content?: string;
  readonly dateGmt?: string;
  readonly meta?: readonly { key: string; value: string }[];
}

export const SITE = 'https://blog.example';

export function wxr(items: readonly TestItem[]): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
	xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:wfw="http://wellformedweb.org/CommentAPI/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:wp="http://wordpress.org/export/1.2/"
>
<channel>
	<title>Blog &amp; Co</title>
	<link>${SITE}</link>
	<description>A test blog.</description>
	<language>en-US</language>
	<wp:wxr_version>1.2</wp:wxr_version>
	<wp:base_site_url>${SITE}</wp:base_site_url>
	<wp:base_blog_url>${SITE}</wp:base_blog_url>
	<wp:author><wp:author_id>2</wp:author_id><wp:author_login><![CDATA[ada]]></wp:author_login><wp:author_email><![CDATA[ada@blog.example]]></wp:author_email><wp:author_display_name><![CDATA[Ada Lovelace]]></wp:author_display_name></wp:author>
${items.map(item).join('\n')}
</channel>
</rss>
`;
}

function item(entry: TestItem): string {
  const type = entry.type ?? 'post';
  const slug = entry.slug ?? `item-${String(entry.id)}`;
  const dateGmt = entry.dateGmt ?? '2024-03-05 14:30:00';
  return `	<item>
		<title><![CDATA[${entry.title ?? `Item ${String(entry.id)}`}]]></title>
		<link>${entry.link ?? `${SITE}/2024/03/${slug}/`}</link>
		<pubDate>Tue, 05 Mar 2024 14:30:00 +0000</pubDate>
		<dc:creator><![CDATA[${entry.creator ?? 'ada'}]]></dc:creator>
		<guid isPermaLink="false">${entry.guid ?? `${SITE}/?p=${String(entry.id)}`}</guid>
		<description></description>
		<content:encoded><![CDATA[${entry.content ?? `<p>Body of ${String(entry.id)}.</p>`}]]></content:encoded>
		<excerpt:encoded><![CDATA[]]></excerpt:encoded>
		<wp:post_id>${String(entry.id)}</wp:post_id>
		<wp:post_date><![CDATA[${entry.date ?? '2024-03-05 09:30:00'}]]></wp:post_date>
		<wp:post_date_gmt><![CDATA[${dateGmt}]]></wp:post_date_gmt>
		<wp:post_modified><![CDATA[2024-03-05 09:30:00]]></wp:post_modified>
		<wp:post_modified_gmt><![CDATA[${entry.modifiedGmt ?? dateGmt}]]></wp:post_modified_gmt>
		<wp:comment_status><![CDATA[open]]></wp:comment_status>
		<wp:ping_status><![CDATA[open]]></wp:ping_status>
		<wp:post_name><![CDATA[${slug}]]></wp:post_name>
		<wp:status><![CDATA[${entry.status ?? 'publish'}]]></wp:status>
		<wp:post_parent>${String(entry.parent ?? 0)}</wp:post_parent>
		<wp:menu_order>0</wp:menu_order>
		<wp:post_type><![CDATA[${type}]]></wp:post_type>
		<wp:post_password><![CDATA[${entry.password ?? ''}]]></wp:post_password>
		<wp:is_sticky>0</wp:is_sticky>
${entry.attachmentUrl === undefined ? '' : `		<wp:attachment_url><![CDATA[${entry.attachmentUrl}]]></wp:attachment_url>`}
${(entry.terms ?? [])
  .map(
    (term) =>
      `		<category domain="${term.taxonomy}" nicename="${term.slug}"><![CDATA[${term.name}]]></category>`,
  )
  .join('\n')}
${(entry.meta ?? []).map(meta('postmeta')).join('\n')}
${(entry.comments ?? []).map(comment).join('\n')}
	</item>`;
}

function meta(element: string): (entry: { key: string; value: string }) => string {
  return (entry) =>
    `		<wp:${element}><wp:meta_key><![CDATA[${entry.key}]]></wp:meta_key><wp:meta_value><![CDATA[${entry.value}]]></wp:meta_value></wp:${element}>`;
}

function comment(entry: TestComment): string {
  const dateGmt = entry.dateGmt ?? '2024-03-06 10:00:00';
  return `		<wp:comment>
			<wp:comment_id>${String(entry.id)}</wp:comment_id>
			<wp:comment_author><![CDATA[${entry.author ?? 'Weldon'}]]></wp:comment_author>
			<wp:comment_author_email><![CDATA[weldon@mstdn.example]]></wp:comment_author_email>
			<wp:comment_author_url>https://mstdn.example/@weldon</wp:comment_author_url>
			<wp:comment_author_IP><![CDATA[192.0.2.1]]></wp:comment_author_IP>
			<wp:comment_date><![CDATA[2024-03-06 05:00:00]]></wp:comment_date>
			<wp:comment_date_gmt><![CDATA[${dateGmt}]]></wp:comment_date_gmt>
			<wp:comment_content><![CDATA[${entry.content ?? 'Nice.'}]]></wp:comment_content>
			<wp:comment_approved><![CDATA[${entry.approved ?? '1'}]]></wp:comment_approved>
			<wp:comment_type><![CDATA[${entry.type ?? 'comment'}]]></wp:comment_type>
			<wp:comment_parent>${String(entry.parent ?? 0)}</wp:comment_parent>
			<wp:comment_user_id>0</wp:comment_user_id>
${(entry.meta ?? []).map(meta('commentmeta')).join('\n')}
		</wp:comment>`;
}
