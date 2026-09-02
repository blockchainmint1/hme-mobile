INSERT INTO public.app_releases (platform, version, ipfs_cid, download_url, notes, released_at)
VALUES (
  'android',
  '0.1.202609020414',
  NULL,
  'https://hme-wallet.lovable.app/__l5e/assets-v1/d5d6fed0-d11b-4dfb-be1b-731b9eecfc78/hme-wallet-0.1.202609020414-release.apk',
  'Latest Android release.',
  now()
)
ON CONFLICT (platform, version) DO UPDATE SET
  download_url = EXCLUDED.download_url,
  notes = EXCLUDED.notes,
  released_at = EXCLUDED.released_at;
