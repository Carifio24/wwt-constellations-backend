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


## The `images` collection

Each document in the `images` collection may have the following fields:

- `_id`: the ObjectID of the image
- `handle_id`: the ObjectID of the handle that owns this image
- `creation_date`: the ISODate when this image was created
- `wwt`: imageset parameters understood by WWT; see WWT docs for specifications
  - `base_degrees_per_tile` (float)
  - `bottoms_up` (boolean)
  - `center_x` (float)
  - `center_y` (float)
  - `file_type` (string)
  - `offset_x` (float)
  - `offset_y` (float)
  - `projection` (string)
  - `quad_tree_map` (string)
  - `rotation` (number)
  - `tile_levels` (integer)
  - `width_factor` (int)
  - `thumbnail_url` (string)
- `storage`: information about the data storage for this image
  - `legacy_url_template` (string?) - if present, the image is a WWT "legacy"
    image with data stored somewhere outside of Constellations
  - Other mechanisms will be added for data uploaded directly to Constellations
- `note` (string): a short freeform description of the image; currently intended
  only to be shown to its owning user(s).

The following WWT parameters are currently assumed to be fixed at the following values:

- `BandPass = Visible`
- `BaseTileLevel = 0`
- `DataSetType = Sky`
- `ElevationModel = False`
- `Generic = False`
- `Sparse = True`
- `StockSet = False`

To-do:

- Credits information
- Other storage mechanisms


## The `scenes` collection

Each document in the `scenes` collection may have the following fields:

- `_id`: the ObjectID of the scene
- `handle_id`: the ObjectID of the handle that owns this scene
- `creation_date`: the ISODate when this scene was created
- `place`: WWT "Place" information
  - `ra_rad` (number) target camera RA in radians
  - `dec_rad` (number) target camera declination in radians
  - `zoom_deg` (number) target camera zoom in degrees (zoom = viewport height * 6)
  - `roll_rad` (number) target camera roll angle in radians
- `impressions` (number) the number of impressions this scene has
- `likes` (number) the number of likes this scene has
- `text` (string) The human-readable text associated with the scene
- `outgoing_url` (optional string) a URL that viewers of the scene should be
  encouraged to click
- `content`: information about the actual contents of the scene
  - `image_layers`: optional array of ImageLayer records (see below).

An ImageLayer record may have the following fields:

- `image_id`: the ObjectID of the image
- `opacity`: the opacity with which the image should be drawn, between 0 and 1

To-do:

- Specify background map
- "Publication date" or other mechanism to not immediately publish
- Credits information (or are credits attached to images sufficient?)
- Clarify semantics of the "text" item
