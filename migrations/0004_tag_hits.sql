create table if not exists tag_hits (
  user_id text not null,
  tag text not null,
  tweet_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);
