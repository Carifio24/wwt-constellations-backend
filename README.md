# WorldWide Telescope Constellations: The Backend

This is an ExpressJS web server that communicates with a [MongoDB] storage
backend (location specified with the `MONGO_CONNECTION_STRING` environment
variable), a [Keycloak server][keycloak] (specified with `KEYCLOAK_URL`), and an
instance of the [WWT Constellations previewer service][previewer] (specified
with `CX_PREVIEW_SERVICE_URL`), which in turn relies on an [Azure Storage
server][azurite] (potentially using a [local emulator][azurite]).

[keycloak]: https://www.keycloak.org/
[MongoDB]: https://www.mongodb.com/
[previewer]: https://github.com/WorldWideTelescope/wwt-constellations-previewer/
[azurite]: https://github.com/Azure/Azurite

The [WWT Constellations frontend server][frontend] communicates with this
backend to create the WWT Constellations app experience. See the frontend README
for information on how to start up a development Keycloak server.

[frontend]: https://github.com/WorldWideTelescope/wwt-constellations-frontend/


## Basic Workflow

Make sure to install the dependencies:

```bash
yarn install
```

Build the application for production:

```bash
yarn build
```

Start the server (defaulting to run on http://localhost:7000):

```bash
yarn start
```


## Configuration

Environment variables:

- `PORT` to set the port for the server to listen on; default is 7000.
- `MONGO_CONNECTION_STRING` to set the path to MongoDB server; must be specified.
  - `AZURE_COSMOS_CONNECTIONSTRING` has the same effect and higher priority
- `KEYCLOAK_URL` to set the location of the Keycloak server; default is
  `http://localhost:8080/`. If the value of this setting does not end with a slash,
  the server appends one internally.
- `CX_PREVIEW_BASE_URL` sets the base used to construct the URLs of social media
  preview content associated with different scenes.
- `CX_PREVIEW_SERVICE_URL` sets the URL of the
  [wwt-constellations-previewer][previewer] service, which creates previews and
  deposits them in the storage backend. No default, but for local testing the
  usual setting would be `http://localhost:5000`.
- `CX_SESSION_SECRETS` is a space-delimited list of secrets used to hash session
  cookies. Default is `dev-secret`. The first secret is used for creating new
  sessions; any subsequent secrets are used for checking existing sessions,
  allowing use to rotate the secret periodically.
- `CX_SUPERUSER_ACCOUNT_ID` sets the Keycloak account ID of an account that can
  perform some special administrative tasks.

[CORS]: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

## Bootstrapping a Development Environment

Bootstrapping a server for local testing requires a bit of work to set up a
complete environment. The following steps use Docker to get everything going.
They have been tested on a Linux environment but might work on other operating
systems as well.

(We should really set this up in [docker-compose] but haven't yet done so!)

[docker-compose]: https://docs.docker.com/compose/

1. First, you need to set up a [Keycloak][keycloak] identity server. It will not
  be secure, but that's OK for development purposes.
    1. Create and start a long-lived Docker container instance for the server:
        ```
        docker create \
          --name cx-keycloak \
          -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=mypass \
          -p 8080:8080 \
          quay.io/keycloak/keycloak start-dev

        docker start cx-keycloak
        ```
    1. Navigate to http://localhost:8080/ to get the Keycloak admin UI
    1. Log in with the admin username and password you specified
    1. Using the top-left dropdown, create a new realm named `constellations`
    1. In the Clients tab, create a new client
        1. Call it `constellations-app`
        1. Use `http://localhost:3000/` as the "root" and "home" URLs.
        1. Add `http://localhost:3000/*` as a valid redirect URLs
        1. Add `*` as allowed web origin
    1. Create another new client
        1. Call it `cli-tool`
        1. Turn on "Implicit Flow" in its Capability Config. (TODO: check if this
            is necessary?)
        1. Set `*` as the redirect URLs.
    1. In the Users tab, create a new user for yourself
        1. Choose a username
        1. After creation, in the Credentials tab of the user, set a password.
            You can save yourself time later by unchecking the "Temporary" box.
        1. In the "Details" panel, note the client ID. Create a file called `.env`
          in the directory containing this README and add a line of the form:
           ```
           CX_SUPERUSER_ACCOUNT_ID="<your account id>"
           ```
1. Now we need to set up a [MongoDB] database server.
    1. We'll once again use Docker. Although there is a [Microsoft Cosmos/Mongo
      emulator docker image][ms-mongo] that might mirror what we run in production
      more closely, [it is broken right now][2] (March 2023).
        ```
        docker create \
          --name cx-mongodb \
          -p 27017:27017 \
          -e MONGO_INITDB_ROOT_USERNAME=admin \
          -e MONGO_INITDB_ROOT_PASSWORD=mypass \
          mongo:latest

        docker start cx-mongodb
        ```
    1. Add a line to your `.env` file of the form:
        ```
        MONGO_CONNECTION_STRING="mongodb://admin:mypass@localhost:27017/"
        ```
1. Next, we need an Azure Storage service, which can be emulated with
   [Azurite][azurite].
    1. Create or choose a local directory in which your data will be stored.
    1. More Docker:
          ```
          docker create \
            --name cx-storage \
            -p 10000:10000 \
            -v {your-data-directory}:/data:rw \
            mcr.microsoft.com/azure-storage/azurite \
            azurite-blob --blobHost 0.0.0.0

          docker start cx-storage
          ```
    1. Export an environment variable named `AZURE_STORAGE_CONNECTION_STRING`
        using the default HTTP connection string for the blob service [listed in the
        Azurite README](https://github.com/Azure/Azurite#connection-strings).
    1. Create a storage container in the service named `previews`. If you use the
        ["az" CLI tool](https://learn.microsoft.com/en-us/cli/azure/), you can do
        this with:
        ```
        az storage container create --name previews
        ```
1. After this, you can start an instance of the [previewer service][previewer].
    See [the previewer
    README](https://github.com/WorldWideTelescope/wwt-constellations-previewer/#readme)
    for instructions.
    1. If you build the previewer as a Docker image, you can run it with:
        ```
        docker create \
          --name cx-previewer \
          --net=host \
          -e NUXT_PUBLIC_API_URL={your value} \
          -e MONGO_CONNECTION_STRING={your value} \
          -e AZURE_STORAGE_CONNECTION_STRING={your value} \
          aasworldwidetelescope/constellations-previewer:latest

        docker start cx-previewer
        ```
    1. Add a line to your `.env` file of the form:
        ```
        CX_PREVIEW_SERVICE_URL="http://localhost:5000"
        ```
1. Now we should be able to successfully start the backend server.
    1. Run `yarn install` (if needed) to fetch dependencies
    1. Run `yarn build` to build it
    1. Run `yarn start` to start it
    1. The server should say that it is connected to the database and report
        that it is running at `http://localhost:7000/`.
1. Finally, we need to complete the database setup and populate it with some content.
    1. Ensure that the latest version of the [`wwt_api_client`] Python package
       is installed.
    1. In the terminal in which you'll be working, export the environment variable
        `NUXT_PUBLIC_API_URL="http://localhost:7000"`
    1. Run the following Python code to test your login. You should be prompted
        to open a browser window and login to the Keycloak server, where you can
        use the username and password that you set up for your personal account
        above:
        ```python
        from wwt_api_client import constellations as cx
        client = cx.CxClient()
        client._send_and_check("/misc/amisuperuser", http_method="GET").json()
        ```
        This should work and return `{"result": True}`.
    1. Run the following code to do some database setup:
        ```python
        client._send_and_check("/misc/config-database").json()
        ```
        This should return `{"error": False}`.
    1. Set up the JWST handle:
        1. Download the current JWST WTML file locally with something like:
            ```
            curl -fsSL http://www.worldwidetelescope.org/wwtweb/catalog.aspx?W=jwst >jwst.wtml
            ```
        1. Import content using the `scratch/bootstrap_handle.py` script:
            ```
            python3 scratch/bootstrap_handle.py \
              --display-name "James Webb Space Telescope" \
              --my-account-id {your-account-id} \
              --copyright "Public domain" \
              --license-id CC-PDDC \
              jwst \
              jwst.wtml
            ```
            (The account ID here has to be the one that your `wwt_api_client`
            client is logged in as. As far as I know this value is not directly
            available to the client, but it's in our `.env` file.)
    1. Set up other handles as desired.
        1. Using the `catalog.aspx` URL as above with `studiesnoao` gives the
           NOIRLab collection.
        1. `eso` is ESO
        1. `geministudies` is old Gemini stuff
        1. `studieschandra` is mostly old Chandra stuff
        1. `studieshubble` you can guess
        1. `studiesspitzer` same
        1. `wise` same

[1]: https://github.com/worldWideTelescope/wwt-constellations-frontend/#keycloak-development-server
[ms-mongo]: https://learn.microsoft.com/en-us/azure/cosmos-db/docker-emulator-linux
[2]: https://github.com/MicrosoftDocs/azure-do0cs/issues/94775
[`wwt_api_client`]: https://github.com/WorldWideTelescope/wwt_api_client