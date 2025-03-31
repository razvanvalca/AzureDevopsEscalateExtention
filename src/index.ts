import * as SDK from "azure-devops-extension-sdk";
import {
  IWorkItemFormService,
  WorkItem,
} from "azure-devops-extension-api/WorkItemTracking/";
import { getClient } from "azure-devops-extension-api";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";

let currentWorkItemId: number | undefined;
let currentProjectName: string | undefined;

// Called when user clicks the Escalate button
async function onEscalateClick() {
  const escalateBtn = document.getElementById("escalate-btn") as HTMLButtonElement;
  if (!escalateBtn) return; // safety check

  // Disable the button and show loading text
  escalateBtn.disabled = true;
  escalateBtn.textContent = "Escalating...";

  if (!currentWorkItemId || !currentProjectName) {
    alert(
      "Work item data is missing. Make sure this extension is running in a valid work item form."
    );
    // Re-enable and revert button text (just in case you want the user to retry)
    escalateBtn.disabled = false;
    escalateBtn.textContent = "Escalate to 2nd";
    return;
  }

  try {
    const witClient = getClient(WorkItemTrackingRestClient);

    // Retrieve the current work item (including your custom field)
    const currentWorkItem: WorkItem = await witClient.getWorkItem(currentWorkItemId);

    console.log("Current Work Item:", currentWorkItem);

    // 1. Read the custom field "Custom.CTRM_CustomerDetails"
    const customerDetails =
      currentWorkItem.fields["Custom.CTRM_CustomerDetails"] || "";

    // 2. Use a regex to extract the fuse portal link
    const fuseLinkRegex = /(https:\/\/fuse\.portals\.swisslife\.ch\/dashboard\/[^"\)]+)/i;
    const match = fuseLinkRegex.exec(customerDetails);

    let fuseLinkHTML = "";
    if (match && match[1]) {
      fuseLinkHTML = `
        <p>
          <a href="${match[1]}" target="_blank">Show customer in Fuse</a>
        </p>
      `;
    }

    // Prepare a link to the current (parent) support ticket
    const supportTicketLink = `https://dev.azure.com/${SDK.getHost().name}/${currentProjectName}/_workitems/edit/${currentWorkItemId}`;

    // The existing support ticket description (HTML)
    const originalDescription = currentWorkItem.fields["System.Description"] || "";

    // 3. Construct the HTML for the new Issue's description
    const newIssueDescription = `
      ${fuseLinkHTML}
      <p>
        Escalated from Support Ticket
        <a href="${supportTicketLink}" target="_blank">#${currentWorkItemId}</a>.
      </p>
      <p>Original Description:</p>
      ${originalDescription}
    `;

    // 4. Construct the PATCH document for creating the new Issue
    const patchDocument = [
      {
        op: "add",
        path: "/fields/System.Title",
        value: `Escalated from #${currentWorkItemId}: ${currentWorkItem.fields["System.Title"]}`,
      },
      {
        op: "add",
        path: "/fields/System.AreaPath",
        value: "CTRM\\Customer Support Center\\Kundenportal\\Product Owner",
      },
      {
        op: "add",
        path: "/fields/System.Description",
        value: newIssueDescription,
      },
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: `https://dev.azure.com/${SDK.getHost().name}/${currentProjectName}/_apis/wit/workItems/${currentWorkItemId}`,
        },
      },
    ];

    // 5. Create the new Issue
    const createdWorkItem: WorkItem = await witClient.createWorkItem(
      patchDocument,
      currentProjectName,
      "Issue"
    );

    // -----------------------------
    // (1) Copy Comments to new item
    // -----------------------------
    const commentsResponse = await witClient.getComments(currentWorkItemId);
    if (commentsResponse?.comments) {
      for (const c of commentsResponse.comments) {
        const patchDocumentForComment = [
          {
            op: "add",
            path: "/fields/System.History",
            value: c.text,
          },
        ];
        await witClient.updateWorkItem(patchDocumentForComment, createdWorkItem.id);
      }
    }

    // ----------------------------------------------------
    // (2) Change AreaPath of the current Support Ticket
    // ----------------------------------------------------
    await witClient.updateWorkItem(
      [
        {
          op: "add",
          path: "/fields/System.AreaPath",
          value: "CTRM\\Customer Support Center\\Kundenportal\\Product Owner",
        },
      ],
      currentWorkItemId
    );

    alert(`Issue #${createdWorkItem.id} successfully created and linked.`);

    // Hide the button after success
    escalateBtn.style.display = "none";
  } catch (error) {
    console.error("Failed to create work item:", error);
    alert("Failed to create work item. Check console for details.");
    // Re-enable and revert button text so user can retry
    escalateBtn.disabled = false;
    escalateBtn.textContent = "Escalate to 2nd";
  }
}

/**
 * Provider for the work item form events (like onLoaded, onFieldChanged, etc.)
 */
function workItemFormProvider() {
  return {
    // Called when the work item is fully loaded in the form
    onLoaded: async (_args: any) => {
      try {
        const formService: IWorkItemFormService =
          await SDK.getService<IWorkItemFormService>(
            "ms.vss-work-web.work-item-form"
          );

        currentWorkItemId = await formService.getId();

        const fieldValues = await formService.getFieldValues([
          "System.TeamProject",
          "System.Title",
          "System.AreaPath",
        ]);
        currentProjectName = fieldValues["System.TeamProject"] as string;

        const areaPath = fieldValues["System.AreaPath"] as string;
        const escalateBtn = document.getElementById("escalate-btn");
        if (escalateBtn) {
          if (
            areaPath ===
            "CTRM\\Customer Support Center\\Kundenportal\\Kundenportalsupport"
          ) {
            escalateBtn.style.display = "inline-block";
          } else {
            escalateBtn.style.display = "none";
          }
        }
      } catch (err) {
        console.error("Error loading work item data:", err);
      }
    },

    onFieldChanged: (_args: any) => {
      // If you need to handle field changes, do it here
    },
  };
}

// Initialize the extension
SDK.init();

SDK.ready().then(() => {
  SDK.register(SDK.getContributionId(), workItemFormProvider);

  const escalateBtn = document.getElementById("escalate-btn");
  if (escalateBtn) {
    escalateBtn.addEventListener("click", onEscalateClick);
  }
});
