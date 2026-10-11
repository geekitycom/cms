# Default theme

The templates and the stylesheet that every Geekity CMS site gets, shipped
inside `@geekity/cms`. A site theme can replace one template at a time. The
rest come from this theme.

## Override a template

```sh
mkdir -p themes/mine/layouts
echo '{ "name": "Mine", "kind": "site" }' > themes/mine/theme.json
cp node_modules/@geekity/cms/themes/default/layouts/post.njk themes/mine/layouts/
```

Edit the copy, then choose **Mine** on **Appearance > Themes** in the admin.
Every template that your theme does not ship still comes from the default
theme.

## Documentation

[The default theme](https://github.com/geekitycom/cms/blob/main/docs/theme/README.md)
lists every file in this folder. Each topic has a page of its own:

- [The manifest](https://github.com/geekitycom/cms/blob/main/docs/theme/manifest.md)
- [Overriding a template](https://github.com/geekitycom/cms/blob/main/docs/theme/overriding-a-template.md)
- [Adding to every page](https://github.com/geekitycom/cms/blob/main/docs/theme/adding-to-every-page.md)
- [The page shell](https://github.com/geekitycom/cms/blob/main/docs/theme/page-shell.md)
- [Mail templates](https://github.com/geekitycom/cms/blob/main/docs/theme/mail-templates.md)
- [Template context](https://github.com/geekitycom/cms/blob/main/docs/theme/template-context.md)
- [Bylines and author archives](https://github.com/geekitycom/cms/blob/main/docs/theme/bylines.md)
- [Navigation](https://github.com/geekitycom/cms/blob/main/docs/theme/navigation.md)
- [Feeds](https://github.com/geekitycom/cms/blob/main/docs/theme/feeds.md)
- [The conversation](https://github.com/geekitycom/cms/blob/main/docs/theme/conversation.md)
- [The comment form](https://github.com/geekitycom/cms/blob/main/docs/theme/comment-form.md)
- [The contact form](https://github.com/geekitycom/cms/blob/main/docs/theme/contact-form.md)
- [Taxonomy macros](https://github.com/geekitycom/cms/blob/main/docs/theme/taxonomy-macros.md)
- [Filters](https://github.com/geekitycom/cms/blob/main/docs/theme/filters.md)
