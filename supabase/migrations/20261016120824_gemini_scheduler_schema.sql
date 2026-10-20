-- pg_net was introduced by M4 and has no application data. Reinstall its
-- extension metadata outside public; its API remains in the net schema.
DROP EXTENSION pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;
