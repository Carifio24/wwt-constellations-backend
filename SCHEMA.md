# WWT Constellations Backend Database Schema.

The Constellations database on the backing MongoDB server is called
`constellations` by default. The database contains the following collections:

- `handles`
- `images`
- `scenes`
- `events`


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
- `alt_text` (string): a textual description of the image intended for visually
  impaired users. Free-form plain text.
- `permissions`: information about image permissions (license, credits, etc.)
  - `copyright` (string): A string describing the image's copyright statement
  - `credits` (optional string): An HTML string describing image credits; HTML to allow
    for e.g. hyperlinks. Sanitized to prevent XSS.
  - `license` (string): A valid SPDX expression describing the image license
- `builtin_background_sort_key` (integer): if present and non-negative, the
  image is one of the built-in options suitable for use as wide-area
  backgrounds. The options are presented to the user sorted by increasing values
  of this key. This value is manually set for a small number of special images.

The following WWT parameters are currently assumed to be fixed at the following values:

- `BandPass = Visible`
- `BaseTileLevel = 0`
- `DataSetType = Sky`
- `ElevationModel = False`
- `Generic = False`
- `Sparse = True`
- `StockSet = False`

To-do:

- Other storage mechanisms


## The `scenes` collection

Each document in the `scenes` collection may have the following fields:

- `_id`: the ObjectID of the scene
- `handle_id`: the ObjectID of the handle that owns this scene
- `creation_date`: the ISODate when this scene was created
- `place`: WWT "Place" information
  - `ra_rad` (number) target camera RA in radians
  - `dec_rad` (number) target camera declination in radians
  - `roll_rad` (number) target camera roll angle in radians
  - `roi_height_deg` (number) the height of the region of interest, in degrees
  - `roi_aspect_ratio` (number) the aspect ratio of the rectangle defining the
    region of interest. This value is used to tune the WWT zoom level depending
    on the aspect ratio of the user's viewport.
- `impressions` (number) the number of impressions this scene has
- `likes` (number) the number of likes this scene has
- `clicks` (number) the number of clicks to a scene's `outgoing_url` in the frontend
- `shares` (number) the number of times this scene has been shared
- `text` (string) The human-readable text associated with the scene
- `outgoing_url` (optional string) a URL that viewers of the scene should be
  encouraged to click
- `content`: information about the actual contents of the scene
  - `image_layers`: optional array of ImageLayer records (see below).
  - `background_id`: (optional ObjectID) The ObjectID of the scene's background image
- `previews`: information about different preview types
  - `video`: (optional string) The basename of the video preview in its blob
    container, if one exists
  - `thumbnail`: (optional string) The basename of the preview thumbnail image
    in the blob container, if one exists
- `published` (boolean): Whether or not the scene has been published. This affects
    whether it will appear in timelines.
- `home_timeline_sort_key` (integer): if present and non-negative, the scene is
  included in the global home timeline, with its position set by the ordering of
  these values.
- `astropix`: information associating this scene with an AstroPix record
  - `publisher_id`: (string) the publisher ID of the AstroPix record
  - `image_id`: (string) the image ID of the AstroPix record

An ImageLayer record may have the following fields:

- `image_id`: the ObjectID of the image
- `opacity`: the opacity with which the image should be drawn, between 0 and 1

To-do:

- "Publication date" or other mechanism to not immediately publish
- Clarify semantics of the "text" item


## The `events` collection

Each document in the `events` collection may have the following fields:

- `kind`: the kind of event
- `sid`: the frontend session ID associated with the event
- `date`: the ISODate of this event

If `kind` is `"click"`:

- `scene_id`: the ObjectId of the scene that was clicked

If `kind` is `"impression"`:

- `scene_id`: the ObjectId of the scene that had an impression

If `kind` is `"like"`:

- `scene_id`: the ObjectId of the scene that was liked
- `delta` (number): either +1 (indicating a like) or -1 (indicating an un-like)


## The `tessellations` collection

Each document in the `tessellations` collection has the following fields:

- `_id`: the ObjectID of the tessellation
- `name`: a human-readable name for the tessellation
- `neighbors`: a list of neighbors for each point in the tessellation.
The i-th entry in the list is itself a list which gives the index numbers of
the neighbors for the i-th scene in the tessellation
- `polygons`: a list of polygons describing the tessellation cells.
The i-th entry in the list is a list of points (in spherical coordinates, using radians)
which specify the vertices of the polygon
- `points`: a list of the locations (RA/Dec, in radians) of the relevant scenes
- `scene_ids`: a list of the IDs of the scenes used in the tessellations
- `last_updated`: a timestamp of when the tessellation was last updated
