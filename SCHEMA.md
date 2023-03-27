# WWT Constellations Backend Database Schema.

The Constellations database on the backing MongoDB server is called
`constellations` by default. The database contains the following collections:

- `handles`
- `images`
- `scenes`


## The `handles` collection

Each document in the `handles` collection may have the following fields:

- `_id`: the ObjectID of the handle document
- `handle`: a string giving the short form of the handle that will appear
  in URLs. This field is associated with a unique index. We should limit these
  to something like lowercase alphanumerics and simple punctuation
- `display_name`: a longer, display name associated with the handle. This can
  contain spaces, accents, etc. but is still just plain text. We should specify
  a maximum length.
- `creation_date`: the ISODate when this handle was created
- `owner_accounts`: an array of strings giving the Keycloak account IDs that
  have full ownership control of this handle.
