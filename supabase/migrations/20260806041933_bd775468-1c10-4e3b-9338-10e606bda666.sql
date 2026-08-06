CREATE TABLE public.app_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','web')),
  version TEXT NOT NULL,
  build_number BIGINT,
  ipfs_cid TEXT,
  download_url TEXT,
  notes TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (platform, version)
);

GRANT SELECT ON public.app_releases TO anon;
GRANT SELECT ON public.app_releases TO authenticated;
GRANT ALL ON public.app_releases TO service_role;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Release info is public" ON public.app_releases FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX app_releases_platform_released_at_idx ON public.app_releases (platform, released_at DESC);

INSERT INTO public.app_releases (platform, version, ipfs_cid, download_url, notes, released_at)
VALUES (
  'android',
  '0.1.202608060318',
  'QmbqBUPo44CPVgpM8w8ZhbhC4AuULvbx3KCz5EuU3Pj2AF',
  'https://txc.mypinata.cloud/ipfs/QmbqBUPo44CPVgpM8w8ZhbhC4AuULvbx3KCz5EuU3Pj2AF?filename=hme-wallet-0.1.202608060318-release.apk',
  'TSD cash-out, faster TXC/TSD sends, bug fixes.',
  now()
);